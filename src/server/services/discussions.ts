import { db } from "@/server/db";
import { OpenRouterError } from "./openrouter";
import {
  computeExplainerContentHash,
  createExplainer,
  getLatestExplainer,
} from "./explainer";
import { recordError } from "./errors";
import { getSetting } from "./settings";
import { verifyBookAccess } from "./reader";
import { getTierBookTokenLimit } from "./model-info";

// ponytail: a discussion attachment the user can add mid-thread. Two slices:
// sections of the current book (sectionHref) and whole OTHER books (bookId).
// Both become permanent context re-sent on every follow-up via the attachment
// suffix (see buildAttachmentSuffix). Cache key/versioning is unaffected.
export type NewDiscussionAttachment =
  | { type: "section"; sectionHref: string }
  | { type: "book"; bookId: string };

// ponytail: per-tier cap on how many OTHER books a discussion can attach.
// Stored as `discussions.attachBook.max.<tier>` AppSetting (integer string),
// mirroring the tts.quota.<tier>.generations pattern. Default 1 for every tier;
// admin can raise/lower per tier. "Only one extra book" = max 1.
const DEFAULT_ATTACH_BOOK_MAX: Record<string, number> = {
  regular: 1,
  pro: 1,
  admin: 1,
};
export async function getAttachBookMax(tier: string): Promise<number> {
  const raw = await getSetting(`discussions.attachBook.max.${tier}`);
  const fallback = DEFAULT_ATTACH_BOOK_MAX[tier] ?? 1;
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ponytail: follow-up turns rebuild the book template as the system message,
// but the citation rule ends up buried under megabytes of {{book_text}} while
// the user's question is the fresh last turn — so the model answers "which
// chapter?" in prose. Re-stating a compact reminder + one shape exemplar
// (follow-ups only, to keep initial-generation prompts lean) flips this:
// few-shot is the strongest lever for fiddly format adherence, especially on
// weaker tiers (Gemini Flash). Hrefs in the exemplar are illustrative — the
// rule tells the model to copy a real href from the chapter map above.
// Upgrade path: promote to an AppSetting / *_followup_suffix template row if
// it needs to be admin-editable.
const FOLLOWUP_CITATION_SUFFIX =
  "\n\nThe same citation rule applies to follow-up questions — especially \"which chapter?\" or \"where does the author …?\" Answer with a (#ch:…) link copied from the chapter map above. Shape (hrefs illustrative — always copy a real one): Q: \"In which chapter does the author discuss X?\" A: \"That's in [Chapter Title](#ch:<real-href>.xhtml), where …\"";

// ponytail: discussions wraps the existing generateExplainer cache logic and
// adds the per-user multi-turn discussion model. Initial response uses the
// same global cache (Explainer table); only follow-up turns are per-user
// (DiscussionMessage table).

export interface InitialResponseEvent {
  type: "chunk" | "cached" | "discussion" | "error" | "status" | "existing";
  chunk?: string;
  cached?: boolean;
  discussionId?: string;
  error?: string;
  // Two-pass progress: "explaining" = hidden pass 1 running; "refining" =
  // streamed pass 2 running. Only emitted for book type when the
  // bookTwoPassEnabled setting is on.
  stage?: "explaining" | "refining";
}

export interface CreateDiscussionParams {
  userId: string;
  bookId: string;
  type: "passage" | "section" | "book";
  passageText?: string;
  passageCfi?: string;
  sectionHref?: string;
  language: string;
  tier: "regular" | "pro" | "admin";
}

/**
 * Stream the initial response for a new discussion. Reuses the existing
 * prompt-builder + cache (Explainer table) so cache hits are instant.
 * On completion, upserts a Discussion and yields its id.
 */
export async function* streamInitialDiscussionResponse(
  params: CreateDiscussionParams
): AsyncGenerator<InitialResponseEvent> {
  const { userId, bookId, type, language, tier } = params;

  // Build the prompt + source text via existing prompt-builder
  const promptData = await buildPromptData(params);

  // Two-pass book explainer: when the admin toggle is on and this is a book
  // request, run a hidden pass-1 explanation then a streamed pass-2 refinement.
  // ponytail: the toggle is read every request (one AppSetting PK lookup) so
  // flipping it takes effect immediately without a redeploy.
  const twoPass =
    type === "book" && (await getSetting("bookTwoPassEnabled")) === "true";

  // ponytail: load the pass-2 template UP FRONT only to get its version for
  // the contentHash salt (cache key must be stable before pass 1 runs). The
  // actual prompt fill happens AFTER pass 1 returns, inside the streamBookTwoPass
  // callback — {{previous_response}} can't exist until then.
  let pass2Version = 0;
  if (twoPass) {
    const { loadBookPass2Template } = await import("./prompt-builder");
    pass2Version = (await loadBookPass2Template()).version;
  }

  const contentHash = computeExplainerContentHash({
    type,
    sourceText: promptData.sourceText,
    bookMd5: promptData.bookMd5,
    promptVersion: promptData.promptVersion,
    twoPassVersion: twoPass ? pass2Version : undefined,
    metadataVersion: promptData.metadataVersion,
  });

  // Reopen: if this user already has a discussion for the same context
  // (version-independent key), navigate them back to it instead of
  // regenerating. Their discussion stays pinned to the version they first saw.
  const existingDiscussion = await db.discussion.findUnique({
    where: {
      userId_contentHash_language_tier: { userId, contentHash, language, tier },
    },
  });
  if (existingDiscussion) {
    yield { type: "existing", discussionId: existingDiscussion.id };
    return;
  }

  // Check cache (shared across all users)
  const cached = await getLatestExplainer({ contentHash, language, contentType: type, tier });

  let explainerId: string;
  let cachedFlag = false;

  if (cached) {
    explainerId = cached.id;
    cachedFlag = true;
    yield { type: "cached", cached: true };
    // ponytail: emit the full cached content as one chunk so the client UI
    // (which expects to accumulate chunks into the assistant message) just
    // works.
    yield { type: "chunk", chunk: cached.content };
  } else {
    // Stream from OpenRouter (mirror explainer.ts:148-167 logic)
    const { streamExplainer, streamBookTwoPass, getOpenRouterConfig } = await import("./openrouter");
    const { apiKey, model } = await getOpenRouterConfig(tier);
    if (!apiKey) {
      await recordError({
        category: "missing_api_key",
        message: `No API key configured for ${tier} tier`,
        userId,
        bookId,
        context: { tier, model, type },
      });
      yield { type: "error", error: "OpenRouter API key not configured" };
      return;
    }
    const maxTokens = type === "book" ? 4096 : 2048;

    // Size guard: combined source + book text. Book type has sourceText ===
    // bookText (double-counts), so use just sourceText there.
    const APPROX_CHARS_PER_TOKEN = 4;
    const maxChars = 900_000 * APPROX_CHARS_PER_TOKEN;
    const combinedChars =
      type === "book"
        ? promptData.sourceText.length
        : promptData.sourceText.length + promptData.bookText.length;
    if (combinedChars > maxChars) {
      await recordError({
        category: "explainer_too_large",
        message: `${type} explainer exceeded size limit (${Math.round(combinedChars / 4)} tokens combined)`,
        userId,
        bookId,
        context: {
          tier,
          model,
          type,
          sourceChars: promptData.sourceText.length,
          bookChars: promptData.bookText.length,
        },
      });
      yield {
        type: "error",
        error: `This ${type} is too large to explain with full-book context.`,
      };
      return;
    }

    let fullContent = "";
    try {
      if (twoPass) {
        // Pass 1 runs hidden (accumulated inside streamBookTwoPass); pass 2 is
        // streamed to the client. Status events let the UI show progress
        // during the silent pass-1 window. The callback fills {{previous_response}}
        // + {{book_text}} once pass 1's output is in hand.
        const { buildBookPass2Prompt } = await import("./prompt-builder");
        for await (const evt of streamBookTwoPass({
          pass1Prompt: promptData.prompt,
          buildPass2Prompt: (pass1Response) =>
            buildBookPass2Prompt(
              bookId,
              language,
              pass1Response,
              promptData.bookText
            ).then((r) => r.prompt),
          apiKey,
          model,
          maxTokens,
        })) {
          if (evt.type === "status") {
            yield { type: "status", stage: evt.stage };
          } else if (evt.type === "chunk" && evt.chunk) {
            fullContent += evt.chunk;
            yield { type: "chunk", chunk: evt.chunk };
          }
        }
      } else {
        for await (const chunk of streamExplainer({
          prompt: promptData.prompt,
          apiKey,
          model,
          maxTokens,
        })) {
          fullContent += chunk;
          yield { type: "chunk", chunk };
        }
      }
    } catch (err: any) {
      const message = err instanceof OpenRouterError ? err.message : "Generation failed";
      await recordError({
        category: "openrouter_error",
        message,
        userId,
        bookId,
        context: { tier, model, type, statusCode: err?.statusCode, twoPass },
      });
      yield { type: "error", error: message };
      return;
    }

    // Save to cache. Handle race: a concurrent request for the same passage
    // (e.g. React StrictMode double-fire in dev, or two users hitting the same
    // passage) can win the create between our cache-miss check and now. On
    // P2002, fall back to fetching the winner's row — we already streamed OUR
    // response to the client, the cache is just an optimization.
    let created;
    try {
      created = await createExplainer({
        contentHash,
        language,
        contentType: type,
        tier,
        content: fullContent,
        modelId: model,
        promptVersion: promptData.promptVersion,
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        const existing = await getLatestExplainer({
          contentHash,
          language,
          contentType: type,
          tier,
        });
        if (!existing) {
          yield { type: "error", error: "Cache write race: lost and couldn't refetch" };
          return;
        }
        created = existing;
      } else {
        throw err;
      }
    }
    explainerId = created.id;
  }

  // Upsert discussion on the version-independent key (one discussion per user
  // per context). Reopen above handles the common case; this upsert also
  // covers a rare race where two concurrent starts slip past the check — the
  // update branch just touches updatedAt and leaves the existing version pin
  // intact.
  const discussion = await db.discussion.upsert({
    where: {
      userId_contentHash_language_tier: { userId, contentHash, language, tier },
    },
    create: {
      userId,
      bookId,
      explainerId,
      contentHash,
      type,
      passageCfi: params.passageCfi,
      passageText: params.passageText,
      sectionHref: params.sectionHref,
      language,
      tier,
      initialCacheHit: cachedFlag,
    },
    update: { updatedAt: new Date() },
  });

  // Record analytics (matches existing pattern)
  await db.explainerRequest.create({
    data: {
      userId,
      bookId,
      explainerId,
      passageCfi: type === "passage" ? (params.passageCfi ?? null) : null,
      passageText:
        type === "passage" ? (params.passageText?.slice(0, 200) ?? null) : null,
      sectionHref: type === "section" ? (params.sectionHref ?? null) : null,
    },
  });

  yield { type: "discussion", discussionId: discussion.id, cached: cachedFlag };
}

/**
 * Build the prompt and source text for the given context. Shared by the
 * initial-response stream and the reroll path. Takes only what it needs so
 * reroll can reuse it without synthesizing a full CreateDiscussionParams.
 */
export async function buildPromptData(params: {
  type: "passage" | "section" | "book";
  bookId: string;
  language: string;
  passageText?: string;
  sectionHref?: string;
}): Promise<{
  prompt: string;
  sourceText: string;
  bookText: string;
  bookMd5: string;
  promptVersion: number;
  metadataVersion?: string;
}> {
  const { type } = params;
  if (type === "passage") {
    if (!params.passageText) {
      throw new Error("passageText is required for passage type");
    }
    const { buildPassagePrompt } = await import("./prompt-builder");
    return buildPassagePrompt(params.bookId, params.passageText, params.language);
  }
  if (type === "section") {
    if (!params.sectionHref) {
      throw new Error("sectionHref is required for section type");
    }
    const { buildSectionPrompt } = await import("./prompt-builder");
    return buildSectionPrompt(
      params.bookId,
      params.sectionHref,
      params.language
    );
  }
  // book
  const { buildBookPrompt } = await import("./prompt-builder");
  return buildBookPrompt(params.bookId, params.language);
}

export interface RerollEvent {
  type: "chunk" | "status" | "version" | "error";
  chunk?: string;
  stage?: "explaining" | "refining";
  version?: number;
  explainerId?: string;
  error?: string;
}

/**
 * Admin: regenerate an explainer as a NEW version of its cache key. Recovers
 * the source context from a linked discussion, regenerates with identical
 * inputs, and writes a higher-versioned row. Existing discussions keep their
 * pinned version (untouched); new discussions get this latest version. Throws
 * (→ 422) if no linked discussion exists to recover source context from.
 */
export async function* rerollExplainer(params: {
  explainerId: string;
  actorId: string;
}): AsyncGenerator<RerollEvent> {
  const explainer = await db.explainer.findUnique({
    where: { id: params.explainerId },
  });
  if (!explainer) {
    yield { type: "error", error: "Explainer not found" };
    return;
  }

  // Recover source context from any discussion linked to this cache key.
  const discussion = await db.discussion.findFirst({
    where: {
      contentHash: explainer.contentHash,
      language: explainer.language,
      tier: explainer.tier,
    },
    select: {
      type: true,
      bookId: true,
      passageText: true,
      sectionHref: true,
      language: true,
    },
  });
  if (!discussion) {
    yield {
      type: "error",
      error: "Cannot reroll: no source context found for this explainer",
    };
    return;
  }

  const type = discussion.type as "passage" | "section" | "book";
  const promptData = await buildPromptData({
    type,
    bookId: discussion.bookId,
    language: discussion.language,
    passageText: discussion.passageText ?? undefined,
    sectionHref: discussion.sectionHref ?? undefined,
  });

  // Re-derive the salt exactly as streamInitialDiscussionResponse does so the
  // new row shares the original cache key (→ a true new version). If two-pass
  // / metadata config changed since the original, the hash differs and this
  // becomes v1 of a new key — still a valid fresh explainer.
  const twoPass = type === "book" && (await getSetting("bookTwoPassEnabled")) === "true";
  let pass2Version: number | undefined;
  if (twoPass) {
    const { loadBookPass2Template } = await import("./prompt-builder");
    pass2Version = (await loadBookPass2Template()).version;
  }
  const contentHash = computeExplainerContentHash({
    type,
    sourceText: promptData.sourceText,
    bookMd5: promptData.bookMd5,
    promptVersion: promptData.promptVersion,
    twoPassVersion: pass2Version,
    metadataVersion: promptData.metadataVersion,
  });

  const { streamExplainer, streamBookTwoPass, getOpenRouterConfig } = await import("./openrouter");
  const { apiKey, model } = await getOpenRouterConfig(
    explainer.tier as "regular" | "pro" | "admin"
  );
  if (!apiKey) {
    yield { type: "error", error: "OpenRouter API key not configured" };
    return;
  }
  const maxTokens = type === "book" ? 4096 : 2048;

  let fullContent = "";
  try {
    if (twoPass) {
      const { buildBookPass2Prompt } = await import("./prompt-builder");
      for await (const evt of streamBookTwoPass({
        pass1Prompt: promptData.prompt,
        buildPass2Prompt: (pass1) =>
          buildBookPass2Prompt(discussion.bookId, discussion.language, pass1, promptData.bookText).then(
            (r) => r.prompt
          ),
        apiKey,
        model,
        maxTokens,
      })) {
        if (evt.type === "status") yield { type: "status", stage: evt.stage };
        else if (evt.type === "chunk" && evt.chunk) {
          fullContent += evt.chunk;
          yield { type: "chunk", chunk: evt.chunk };
        }
      }
    } else {
      for await (const chunk of streamExplainer({
        prompt: promptData.prompt,
        apiKey,
        model,
        maxTokens,
      })) {
        fullContent += chunk;
        yield { type: "chunk", chunk };
      }
    }
  } catch (err: any) {
    const message = err instanceof OpenRouterError ? err.message : "Reroll generation failed";
    yield { type: "error", error: message };
    return;
  }

  // createExplainer computes version = max(existing) + 1 for the key.
  let created;
  try {
    created = await createExplainer({
      contentHash,
      language: explainer.language,
      contentType: explainer.contentType,
      tier: explainer.tier,
      content: fullContent,
      modelId: model,
      promptVersion: promptData.promptVersion,
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      const latest = await getLatestExplainer({
        contentHash,
        language: explainer.language,
        contentType: explainer.contentType as "book" | "section" | "passage",
        tier: explainer.tier as "regular" | "pro" | "admin",
      });
      if (!latest) {
        yield { type: "error", error: "Reroll race: lost and couldn't refetch" };
        return;
      }
      created = latest;
    } else {
      throw err;
    }
  }

  await db.auditLog.create({
    data: {
      actorId: params.actorId,
      action: "EXPLAINER_REROLLED",
      entityType: "explainer",
      entityId: created.id,
      oldValue: JSON.stringify({
        fromVersion: explainer.version,
        contentHash: explainer.contentHash,
      }),
      newValue: JSON.stringify({ toVersion: created.version, contentHash }),
    },
  });

  yield { type: "version", version: created.version, explainerId: created.id };
}

/**
 * List a user's discussions for a book, newest first.
 */
export async function listDiscussionsForBook(userId: string, bookId: string) {
  return db.discussion.findMany({
    where: { userId, bookId },
    include: {
      explainer: { select: { id: true, content: true, modelId: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Delete a discussion and its messages. Ownership-checked (matches the
 * bookmark and highlight delete pattern).
 */
export async function deleteDiscussion(userId: string, discussionId: string) {
  const discussion = await db.discussion.findUnique({
    where: { id: discussionId },
    select: { userId: true },
  });
  if (!discussion || discussion.userId !== userId) {
    throw new Error("Discussion not found or access denied");
  }
  await db.discussion.delete({ where: { id: discussionId } });
}

/**
 * Get a discussion with its messages (ownership-checked).
 */
export async function getDiscussionWithMessages(discussionId: string, userId: string) {
  const discussion = await db.discussion.findUnique({
    where: { id: discussionId },
    include: {
      explainer: { select: { id: true, content: true, modelId: true, promptVersion: true, version: true } },
      messages: { orderBy: { createdAt: "asc" } },
      attachments: {
        orderBy: { createdAt: "asc" },
        // ponytail: book-type attachments carry only bookId; include the
        // attached book's display fields (chip) + txtTokens (context indicator)
        // so the UI can render + budget without a second round-trip. Sections
        // ignore the relation.
        include: {
          book: { select: { id: true, title: true, author: true, coverPath: true, txtTokens: true } },
        },
      },
    },
  });
  if (!discussion || discussion.userId !== userId) return null;
  // ponytail: latest version of this cache key, for the admin "newer version
  // available" indicator. Falls back to the discussion's own version when the
  // legacy contentHash is missing (pre-backfill).
  const latest = discussion.contentHash
    ? await db.explainer.findFirst({
        where: {
          contentHash: discussion.contentHash,
          language: discussion.language,
          contentType: discussion.type,
          tier: discussion.tier,
        },
        orderBy: { version: "desc" },
        select: { version: true },
      })
    : null;
  return {
    ...discussion,
    latestVersion: latest?.version ?? discussion.explainer?.version ?? 1,
  };
}

export interface FollowupEvent {
  type: "chunk" | "done" | "error";
  chunk?: string;
  error?: string;
}

// ponytail: minimal row shape buildAttachmentSuffix and the in-memory merge
// consume. Prisma's DiscussionAttachment rows are a structural superset, so
// both real rows and the synthetic ones persistAttachments returns type-check
// against this. Lifted out of streamFollowup so the blank first turn reuses it.
type DiscussionAttachmentRow = {
  id: string;
  discussionId: string;
  type: string;
  sectionHref: string | null;
  bookId: string | null;
  passageText: string | null;
  passageCfi: string | null;
  createdAt: Date;
};

// Validate newly-attached context against access / per-tier-max / size rules.
// Read-only — safe to call BEFORE a discussion row exists (the blank first turn
// does this so a rejected attach can't leave a dangling empty discussion).
// Sections need no validation (hrefs come from the current book's own ToC), so
// only book attachments are checked.
async function validateNewAttachments(args: {
  userId: string;
  bookId: string;
  tier: string;
  existing: readonly DiscussionAttachmentRow[];
  incoming: readonly NewDiscussionAttachment[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const incomingBooks = args.incoming.filter(
    (a): a is { type: "book"; bookId: string } => a.type === "book"
  );
  if (incomingBooks.length === 0) return { ok: true };

  const max = await getAttachBookMax(args.tier);
  const existingBookIds = new Set(
    args.existing.filter((a) => a.type === "book" && a.bookId).map((a) => a.bookId!)
  );
  const uniqueNew = incomingBooks.filter((a) => !existingBookIds.has(a.bookId));
  if (existingBookIds.size + uniqueNew.length > max) {
    return {
      ok: false,
      error: `Your tier can attach at most ${max} additional book${max === 1 ? "" : "s"} per discussion.`,
    };
  }
  for (const a of uniqueNew) {
    if (!(await verifyBookAccess(args.userId, a.bookId))) {
      return { ok: false, error: "You don't have access to that book." };
    }
  }
  // ponytail: size guard — a whole second book frequently exceeds lower-tier
  // context windows. Only enforced when both books report a cached txtTokens;
  // otherwise we let the request through and rely on the client "X% full"
  // indicator. Upgrade path: a server-side tokenizer count if txtTokens drifts.
  const limit = await getTierBookTokenLimit(args.tier);
  const b1 = await db.epubFile.findUnique({
    where: { id: args.bookId },
    select: { txtTokens: true },
  });
  for (const a of uniqueNew) {
    const b2 = await db.epubFile.findUnique({
      where: { id: a.bookId },
      select: { txtTokens: true },
    });
    if (b1?.txtTokens != null && b2?.txtTokens != null) {
      const total = b1.txtTokens + b2.txtTokens;
      if (total > limit) {
        return {
          ok: false,
          error: `That book is too large to attach here — together both books (~${total.toLocaleString()} tokens) would exceed this tier's context window.`,
        };
      }
    }
  }
  return { ok: true };
}

// Persist newly-attached context (dedup by composite key) and return the rows
// to merge into the discussion's in-memory attachment list. Call AFTER the
// discussion row exists and AFTER validateNewAttachments has passed.
async function persistAttachments(args: {
  discussionId: string;
  existing: readonly DiscussionAttachmentRow[];
  incoming: readonly NewDiscussionAttachment[];
}): Promise<DiscussionAttachmentRow[]> {
  const existingKeys = new Set(
    args.existing.map((a) => `${a.type}|${a.sectionHref ?? ""}|${a.bookId ?? ""}`)
  );
  const toCreate = args.incoming.filter((a) => {
    const key = a.type === "section" ? `section|${a.sectionHref}|` : `book||${a.bookId}`;
    return !existingKeys.has(key);
  });
  if (toCreate.length === 0) return [];
  await db.discussionAttachment.createMany({
    data: toCreate.map((a) => ({
      discussionId: args.discussionId,
      type: a.type,
      sectionHref: a.type === "section" ? a.sectionHref : null,
      bookId: a.type === "book" ? a.bookId : null,
    })),
  });
  const now = new Date();
  return toCreate.map((a) => ({
    id: "",
    discussionId: args.discussionId,
    type: a.type,
    sectionHref: a.type === "section" ? a.sectionHref : null,
    bookId: a.type === "book" ? a.bookId : null,
    passageText: null,
    passageCfi: null,
    createdAt: now,
  }));
}

/**
 * Stream a follow-up response in an existing discussion. Persists the user's
 * message immediately; accumulates the assistant response and persists it
 * on completion.
 *
 * Message order sent to OpenRouter:
 *   [system: filled template w/ source text]
 *   [assistant: initial cached response]
 *   [prior follow-up messages...]
 *   [user: new message]
 *
 * Source text is ALWAYS re-sent on follow-ups (per product decision) so the
 * model has full context regardless of how long the discussion grows.
 */
export async function* streamFollowup(params: {
  discussionId: string;
  userId: string;
  userMessage: string;
  // ponytail: new context the user attached in the composer for THIS turn.
  // Persisted as DiscussionAttachment rows before generation, then re-sent on
  // every future follow-up (see buildAttachmentSuffix). Sections or other books.
  newAttachments?: NewDiscussionAttachment[];
}): AsyncGenerator<FollowupEvent> {
  const discussion = await db.discussion.findUnique({
    where: { id: params.discussionId },
    include: {
      explainer: true,
      messages: { orderBy: { createdAt: "asc" } },
      attachments: true,
    },
  });
  if (!discussion || discussion.userId !== params.userId) {
    yield { type: "error", error: "Discussion not found" };
    return;
  }

  // Validate attachments BEFORE persisting the user's message — a rejected
  // attachment shouldn't leave a dangling user turn. Shared with the blank
  // first turn (see streamBlankFirstTurn) so access/max/size rules can't drift.
  if (params.newAttachments && params.newAttachments.length > 0) {
    const v = await validateNewAttachments({
      userId: params.userId,
      bookId: discussion.bookId,
      tier: discussion.tier,
      existing: discussion.attachments,
      incoming: params.newAttachments,
    });
    if (!v.ok) {
      yield { type: "error", error: v.error };
      return;
    }
  }

  // Save the user's message immediately (even if streaming fails later —
  // the user's intent is preserved).
  await db.discussionMessage.create({
    data: {
      discussionId: discussion.id,
      role: "user",
      content: params.userMessage,
    },
  });

  // Persist newly-attached context (dedup by composite key) before prompt build
  // so this turn's prompt already includes them, then merge into the in-memory
  // discussion so rebuildSystemPrompt/buildAttachmentSuffix see them.
  if (params.newAttachments && params.newAttachments.length > 0) {
    const created = await persistAttachments({
      discussionId: discussion.id,
      existing: discussion.attachments,
      incoming: params.newAttachments,
    });
    if (created.length > 0) {
      discussion.attachments = [...discussion.attachments, ...created];
    }
  }

  // Build the system message by re-filling the template with the source text.
  // ponytail: we stored passageText/sectionHref in the discussion row at
  // creation so we can rebuild the prompt without re-reading the book.
  const systemPrompt = await rebuildSystemPrompt(discussion);
  const attachmentSuffix = await buildAttachmentSuffix(discussion);

  // Compose messages array. The explainer seed is optional — blank
  // discussions (started via "New discussion") have no cached first response,
  // so the model just sees system context + the conversation so far.
  const messages: { role: "system" | "user" | "assistant"; content: string }[] =
    [{ role: "system", content: systemPrompt + attachmentSuffix + FOLLOWUP_CITATION_SUFFIX }];
  if (discussion.explainer) {
    messages.push({ role: "assistant", content: discussion.explainer.content });
  }
  for (const m of discussion.messages) {
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: "user", content: params.userMessage });

  // Resolve current tier model + key (per ponytail decision: follow-ups use
  // the user's CURRENT tier config, not frozen-from-initial-response).
  const { streamChat, getOpenRouterConfig } = await import("./openrouter");
  const { apiKey, model } = await getOpenRouterConfig(discussion.tier);
  if (!apiKey) {
    yield { type: "error", error: "OpenRouter API key not configured" };
    return;
  }

  let fullContent = "";
  try {
    for await (const chunk of streamChat({ apiKey, model, messages })) {
      fullContent += chunk;
      yield { type: "chunk", chunk };
    }
  } catch (err: any) {
    const message = err instanceof OpenRouterError ? err.message : "Follow-up failed";
    yield { type: "error", error: message };
    return;
  }

  // Persist the assistant's response
  await db.discussionMessage.create({
    data: {
      discussionId: discussion.id,
      role: "assistant",
      content: fullContent,
      modelId: model,
    },
  });

  // Touch the discussion's updatedAt so it bubbles to top of the list
  await db.discussion.update({
    where: { id: discussion.id },
    data: { updatedAt: new Date() },
  });

  yield { type: "done" };
}

/**
 * Rebuild the system prompt for a discussion by re-running the appropriate
 * prompt-builder. We need the original source text in the prompt so the
 * model has context for follow-up questions.
 */
async function rebuildSystemPrompt(discussion: {
  type: string;
  bookId: string;
  language: string;
  passageText: string | null;
  sectionHref: string | null;
}): Promise<string> {
  if (discussion.type === "passage") {
    if (!discussion.passageText) {
      throw new Error("Discussion has no passageText to rebuild prompt");
    }
    const { buildPassagePrompt } = await import("./prompt-builder");
    const data = await buildPassagePrompt(
      discussion.bookId,
      discussion.passageText,
      discussion.language
    );
    return data.prompt;
  }
  if (discussion.type === "section") {
    if (!discussion.sectionHref) {
      throw new Error("Discussion has no sectionHref to rebuild prompt");
    }
    const { buildSectionPrompt } = await import("./prompt-builder");
    const data = await buildSectionPrompt(
      discussion.bookId,
      discussion.sectionHref,
      discussion.language
    );
    return data.prompt;
  }
  // book
  const { buildBookPrompt } = await import("./prompt-builder");
  const data = await buildBookPrompt(discussion.bookId, discussion.language);
  return data.prompt;
}

/**
 * Build the "additional context" suffix appended to the system prompt for any
 * sections or other books the user has attached to the discussion. Section text
 * is re-extracted from the EPUB (same path the origin section uses); an
 * attached book's full .txt is loaded (same path buildBookPrompt uses). Returns
 * "" when there are no attachments, so today's no-attachment discussions are
 * byte-identical to before.
 *
 * ponytail: titles resolved from tocJson by basename match (mirrors
 * buildSectionPrompt's logic) — duplicated rather than extracted into a shared
 * helper because the helper would be one more file for a 10-line walk. Upgrade
 * path: lift into a resolveSectionTitle(book, href) util if a third caller appears.
 */
async function buildAttachmentSuffix(discussion: {
  bookId: string;
  attachments?:
    | { type: string; sectionHref: string | null; bookId: string | null }[]
    | readonly { type: string; sectionHref: string | null; bookId: string | null }[];
}): Promise<string> {
  const attachments = discussion.attachments ?? [];
  const sectionAttachments = attachments.filter(
    (a) => a.type === "section" && a.sectionHref
  );
  const bookAttachments = attachments.filter(
    (a) => a.type === "book" && a.bookId
  );
  if (sectionAttachments.length === 0 && bookAttachments.length === 0) return "";

  // --- sections (from the discussion's own book) ---
  let sectionBlock = "";
  if (sectionAttachments.length > 0) {
    const book = await db.epubFile.findUnique({
      where: { id: discussion.bookId },
      select: { epubPath: true, tocJson: true },
    });
    if (book) {
      const { extractSectionText } = await import("./section-extractor");
      const toc = book.tocJson
        ? (JSON.parse(book.tocJson) as Array<{
            label?: string;
            title?: string;
            href?: string;
            subitems?: unknown[];
          }>)
        : [];
      const titleByBasename = new Map<string, string>();
      const walk = (items: typeof toc) => {
        for (const item of items) {
          const b = (item.href ?? "").split("#")[0].split("/").pop();
          if (b && !titleByBasename.has(b)) {
            const label = (item.label ?? item.title ?? "").trim();
            if (label) titleByBasename.set(b, label);
          }
          if (item.subitems && Array.isArray(item.subitems))
            walk(item.subitems as typeof toc);
        }
      };
      walk(toc);

      const parts: string[] = [];
      for (const a of sectionAttachments) {
        const href = a.sectionHref!;
        try {
          const text = await extractSectionText(book.epubPath, href);
          const basename = href.split("#")[0].split("/").pop() ?? "";
          const title = titleByBasename.get(basename) ?? href;
          parts.push(`Section: ${title}\n${text}`);
        } catch {
          // Skip a section whose text can't be extracted rather than failing the
          // whole follow-up — the user's question still goes through with the rest.
        }
      }
      if (parts.length > 0) {
        sectionBlock = `=== Additional context (sections the reader attached) ===\n\n${parts.join("\n\n")}`;
      }
    }
  }

  // --- attached books (full text, like the current book) ---
  let bookBlock = "";
  if (bookAttachments.length > 0) {
    const { loadBookText } = await import("./prompt-builder");
    const parts: string[] = [];
    for (const a of bookAttachments) {
      const ab = await db.epubFile.findUnique({
        where: { id: a.bookId! },
        select: { title: true, author: true, language: true, txtPath: true },
      });
      if (!ab) continue;
      try {
        const text = await loadBookText(ab.txtPath);
        parts.push(
          `Title: "${ab.title}" by ${ab.author ?? "Unknown"} (source language: ${ab.language})\n${text}`
        );
      } catch {
        // Skip an unreadable attached book rather than failing the follow-up.
      }
    }
    if (parts.length > 0) {
      bookBlock = `=== Additional context (another book the reader attached) ===\n\n${parts.join("\n\n")}`;
    }
  }

  const blocks = [sectionBlock, bookBlock].filter(Boolean);
  if (blocks.length === 0) return "";
  return `\n\n${blocks.join("\n\n")}`;
}

export interface BlankFirstTurnEvent {
  type: "discussion" | "chunk" | "error" | "done";
  discussionId?: string;
  chunk?: string;
  error?: string;
}

/**
 * Start a fresh, user-initiated discussion: create a discussion with NO
 * explainer seed, then answer the user's opening question with the full book
 * as system context. Used by the "New discussion" button so clicking it never
 * fires an explainer-generation request — the conversation begins with the
 * user's own question. Emits the new discussionId up front (so the client can
 * pin it), then streams the assistant reply.
 */
export async function* streamBlankFirstTurn(params: {
  userId: string;
  bookId: string;
  language: string;
  tier: "regular" | "pro" | "admin";
  userMessage: string;
  // ponytail: context the user attached in the composer for this opening turn.
  // Same rules as follow-ups (see streamFollowup) — validated before the
  // discussion row exists so a rejected attach can't leave a dangling empty
  // discussion, then persisted + folded into the system prompt as a suffix.
  newAttachments?: NewDiscussionAttachment[];
}): AsyncGenerator<BlankFirstTurnEvent> {
  const { userId, bookId, language, tier, userMessage } = params;

  // Validate attachments BEFORE creating the discussion — a rejected attach
  // shouldn't leave a dangling empty discussion. Shared validator with the
  // follow-up path so access/max/size rules can't drift.
  if (params.newAttachments && params.newAttachments.length > 0) {
    const v = await validateNewAttachments({
      userId,
      bookId,
      tier,
      existing: [],
      incoming: params.newAttachments,
    });
    if (!v.ok) {
      yield { type: "error", error: v.error };
      return;
    }
  }

  // Blank book-level discussion: no explainer, no cache key, no passage/section.
  const discussion = await db.discussion.create({
    data: { userId, bookId, type: "book", language, tier },
  });
  yield { type: "discussion", discussionId: discussion.id };

  // Persist the opening question immediately (intent survives a stream failure).
  await db.discussionMessage.create({
    data: { discussionId: discussion.id, role: "user", content: userMessage },
  });

  // Persist attachments (dedup is a no-op against empty existing) so they
  // become permanent context re-sent on every future turn.
  let attachments: DiscussionAttachmentRow[] = [];
  if (params.newAttachments && params.newAttachments.length > 0) {
    attachments = await persistAttachments({
      discussionId: discussion.id,
      existing: [],
      incoming: params.newAttachments,
    });
  }

  // System prompt = full-book context (the same template follow-ups reuse),
  // plus the attachment suffix so the opening turn already sees any attached
  // books/sections. Empty suffix => byte-identical to the pre-attach behavior.
  const { buildBookPrompt } = await import("./prompt-builder");
  const promptData = await buildBookPrompt(bookId, language);
  const attachmentSuffix =
    attachments.length > 0
      ? await buildAttachmentSuffix({ bookId, attachments })
      : "";

  const { streamChat, getOpenRouterConfig } = await import("./openrouter");
  const { apiKey, model } = await getOpenRouterConfig(tier);
  if (!apiKey) {
    yield { type: "error", error: "OpenRouter API key not configured" };
    return;
  }

  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: promptData.prompt + attachmentSuffix + FOLLOWUP_CITATION_SUFFIX },
    { role: "user", content: userMessage },
  ];

  let fullContent = "";
  try {
    for await (const chunk of streamChat({ apiKey, model, messages })) {
      fullContent += chunk;
      yield { type: "chunk", chunk };
    }
  } catch (err: any) {
    const message = err instanceof OpenRouterError ? err.message : "Generation failed";
    yield { type: "error", error: message };
    return;
  }

  await db.discussionMessage.create({
    data: {
      discussionId: discussion.id,
      role: "assistant",
      content: fullContent,
      modelId: model,
    },
  });
  await db.discussion.update({
    where: { id: discussion.id },
    data: { updatedAt: new Date() },
  });

  yield { type: "done" };
}
