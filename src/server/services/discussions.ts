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
  "\n\nThe same citation rule applies to follow-up questions — especially \"which chapter?\" or \"where does the author …?\" Answer with a (#ch:…) link copied from the chapter map above. Shape (hrefs illustrative — always copy a real one): Q: \"In which chapter does the author discuss X?\" A: \"That's in [Chapter Title](#ch:<real-href>.xhtml), where …\"\n\nFor citations to an ATTACHED book (the additional book(s) provided as context below), use the prefixed form `#ch:<bookId>:<href>` copied verbatim from that book's chapter map — the prefix routes the reader to the right book on click. Shape: Q: \"How does the second book handle X?\" A: \"In [Chapter 3](#ch:<bookId-from-its-map>:<real-href>.xhtml), the author …\"";

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
  type: "passage" | "section" | "book" | "shelf";
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
  const { userId, bookId, language, tier } = params;
  // ponytail: shelf discussions have their own entry point
  // (streamShelfFirstTurn) and never reach here — a runtime guard narrows
  // `type` so the explainer cache / contentHash lookups (which are book-scoped)
  // see the narrow union, and an accidental call throws loudly instead of
  // silently mis-routing through an unchecked cast.
  if (params.type === "shelf") {
    throw new Error(
      "shelf discussions must use streamShelfFirstTurn, not streamInitialDiscussionResponse"
    );
  }
  const type = params.type;

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
  // ponytail: only short-circuit when the pinned explainer actually has
  // content. A prior stream that yielded zero chunks (OpenRouter hiccup)
  // leaves an empty-content explainer linked to the discussion — reopening
  // that would show a blank thread forever. Fall through to regenerate.
  const existingDiscussion = await db.discussion.findUnique({
    where: {
      userId_contentHash_language_tier: { userId, contentHash, language, tier },
    },
    include: { explainer: { select: { content: true } } },
  });
  if (existingDiscussion && existingDiscussion.explainer?.content) {
    yield { type: "existing", discussionId: existingDiscussion.id };
    return;
  }

  // Check cache (shared across all users). ponytail: treat empty-content
  // rows as a miss — a prior failed stream may have persisted a stub.
  const cached =
    (await getLatestExplainer({ contentHash, language, contentType: type, tier })) ?? null;
  const cachedUsable = cached && cached.content ? cached : null;

  let explainerId: string;
  let cachedFlag = false;

  if (cachedUsable) {
    explainerId = cachedUsable.id;
    cachedFlag = true;
    yield { type: "cached", cached: true };
    // ponytail: emit the full cached content as one chunk so the client UI
    // (which expects to accumulate chunks into the assistant message) just
    // works.
    yield { type: "chunk", chunk: cachedUsable.content };
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

    // ponytail: defensive — never persist an empty explainer. OpenRouter can
    // resolve the stream successfully but yield zero chunks (upstream hiccup,
    // content filter, bad model output). Without this guard we'd cache a stub
    // and every future request for this context would reopen a blank thread.
    if (!fullContent.trim()) {
      await recordError({
        category: "explainer_empty",
        message: `${type} explainer stream returned empty content`,
        userId,
        bookId,
        context: { tier, model, type, contentHash },
      });
      yield {
        type: "error",
        error: "The model returned an empty response. Please try again.",
      };
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
  // covers a rare race where two concurrent starts slip past the check, AND
  // the recovery path where we fell through from `existing` because the
  // pinned explainer was empty — in that case the update branch relinks the
  // discussion to the freshly generated explainer.
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
    update: {
      explainerId,
      passageCfi: params.passageCfi,
      passageText: params.passageText,
      sectionHref: params.sectionHref,
      initialCacheHit: cachedFlag,
    },
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
  type: "passage" | "section" | "book" | "shelf";
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
  if (type === "shelf") {
    // ponytail: shelf discussions don't build context from a single book — the
    // ContextSourceStrategy owns it. buildPromptData is shared with reroll,
    // which is book-scoped, so we throw here if ever hit (reroll has no shelf
    // path). The live shelf flows call the strategy directly via
    // streamShelfFirstTurn / rebuildSystemPrompt, not through here.
    throw new Error("shelf discussions build context via ContextSourceStrategy, not buildPromptData");
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
  // ponytail: reroll only recovers source context for book/section/passage
  // discussions (those always have a bookId). A null bookId here is a shelf
  // discussion, which has no source text to reroll — bail with the same shape
  // the existing "no source context" guard above uses.
  if (!discussion.bookId) {
    yield {
      type: "error",
      error: "Cannot reroll: discussion has no source book",
    };
    return;
  }

  const type = discussion.type as "passage" | "section" | "book";
  // ponytail: capture the narrowed bookId once so the closures below
  // (buildPass2Prompt callback) keep the non-null narrowing across the
  // function boundary — TS won't propagate it through the callback.
  const bookId = discussion.bookId;
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
          buildBookPass2Prompt(bookId, discussion.language, pass1, promptData.bookText).then(
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
 * List a user's discussions for a book, newest first. A discussion appears
 * under its origin book (Discussion.bookId) AND under every co-primary book
 * attached to it (DiscussionAttachment type="book") — attach = co-primary.
 * The origin `book` fields are included so the UI can show a "from {title}"
 * hint on rows where discussion.bookId !== the list's currentBookId.
 */
export async function listDiscussionsForBook(userId: string, bookId: string) {
  return db.discussion.findMany({
    where: {
      userId,
      OR: [
        { bookId },
        { attachments: { some: { type: "book", bookId } } },
      ],
    },
    include: {
      book: { select: { id: true, title: true, coverPath: true } },
      explainer: { select: { id: true, content: true, modelId: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * List ALL of a user's discussions across every book, newest first. Powers
 * the homepage Discussions tab. Includes origin book + every attachment (with
 * its book) + the origin/attached books' tocJson so the UI can resolve
 * section labels client-side and render clickable book/section chips.
 *
 * No per-book access check — `where: { userId }` already scopes to
 * discussions this user owns. If a UserBookAccess grant was revoked but the
 * discussion row survives, the reader surfaces the denial on navigation
 * (filtered out of scope here).
 */
export async function listAllDiscussionsForUser(userId: string) {
  const rows = await db.discussion.findMany({
    where: { userId },
    include: {
      book: {
        select: {
          id: true,
          title: true,
          author: true,
          coverPath: true,
          tocJson: true,
          // ponytail: prefer the LLM-extracted main title (BookMetadata.title)
          // over the raw OPF title (EpubFile.title) — the metadata row is the
          // canonical display source per schema.prisma:157-158; the OPF title
          // can be a "Main Title: Subtitle" concatenation. Remapped in-place
          // below so the returned shape matches DiscussionListItem unchanged.
          bookMetadata: { select: { title: true } },
        },
      },
      attachments: {
        include: {
          book: {
            select: {
              id: true,
              title: true,
              author: true,
              coverPath: true,
              tocJson: true,
              bookMetadata: { select: { title: true } },
            },
          },
        },
      },
      explainer: { select: { id: true, content: true, modelId: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  // ponytail: in-place remap — overwrite book.title with the metadata main
  // title when available, then strip bookMetadata so the client-facing shape
  // is unchanged (DiscussionListItem has no bookMetadata field). Done in the
  // service rather than the client so every render site (~6 in
  // discussions-home.tsx) picks up the fix without per-site changes.
  for (const r of rows) {
    if (r.book?.bookMetadata?.title) r.book.title = r.book.bookMetadata.title;
    if (r.book) delete (r.book as { bookMetadata?: unknown }).bookMetadata;
    for (const a of r.attachments) {
      if (a.book?.bookMetadata?.title) a.book.title = a.book.bookMetadata.title;
      if (a.book) delete (a.book as { bookMetadata?: unknown }).bookMetadata;
    }
  }
  return rows;
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
      // ponytail: origin book fields — tocJson so the panel can build hrefs for
      // the origin book's unprefixed #ch: citations when the discussion is
      // viewed from a co-primary (non-origin) book; coverPath + author so the
      // origin book chip renders with a cover thumbnail like attached book chips.
      book: { select: { id: true, title: true, author: true, coverPath: true, tocJson: true } },
      attachments: {
        orderBy: { createdAt: "asc" },
        // ponytail: book-type attachments carry only bookId; include the
        // attached book's display fields (chip) + txtTokens (context indicator)
        // + tocJson (so the panel can build attachedBookHrefs for cross-book
        // citation validation without a second round-trip). Sections ignore
        // the relation.
        include: {
          book: { select: { id: true, title: true, author: true, coverPath: true, txtTokens: true, tocJson: true } },
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
  bookId: string | null;
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
  // ponytail: origin-book size guard only applies when the discussion HAS an
  // origin book (book/section/passage). Shelf discussions (bookId === null)
  // have no origin book to pair against, so skip the b1 lookup — the per
  // attached-book b2 lookup below still runs for its own checks.
  const b1 = args.bookId
    ? await db.epubFile.findUnique({
        where: { id: args.bookId },
        select: { txtTokens: true },
      })
    : null;
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
  const systemPrompt = await rebuildSystemPrompt(discussion, params.userMessage);
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
async function rebuildSystemPrompt(
  discussion: {
    type: string;
    bookId: string | null;
    language: string;
    passageText: string | null;
    sectionHref: string | null;
    userId: string;
    // ponytail: only present on the streamFollowup path (where history matters).
    // Other callers (none today, but kept permissive) may omit it.
    messages?: { role: string; content: string }[];
  },
  currentUserMessage?: string
): Promise<string> {
  if (discussion.type === "shelf") {
    const { getContextSource } = await import("./shelf-knowledge/context-source");
    const { getAccessibleBookIds } = await import("./shelf-knowledge/access");
    const accessibleBookIds = await getAccessibleBookIds(discussion.userId);
    // ponytail: streamFollowup loads `discussion` BEFORE persisting the
    // current userMessage (~:905 load → ~:937 persist → :962 this call), so
    // discussion.messages is exactly the PRIOR turns — no exclusion needed.
    // Take the last ~6 user/assistant turns for nav + answer context.
    const history = (discussion.messages ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    const ctx = await getContextSource().buildContext({
      question: currentUserMessage ?? "",
      userId: discussion.userId,
      accessibleBookIds,
      history,
    });
    return ctx.prompt;
  }
  if (discussion.type === "passage") {
    if (!discussion.passageText) {
      throw new Error("Discussion has no passageText to rebuild prompt");
    }
    if (!discussion.bookId) {
      throw new Error("passage discussion has no bookId");
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
    if (!discussion.bookId) {
      throw new Error("section discussion has no bookId");
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
  // ponytail: book discussions always have a bookId by construction; null here
  // is an invariant violation (corrupt row), not a normal shelf-discussion
  // path — throw so it surfaces loudly rather than silently mis-routing.
  if (!discussion.bookId) {
    throw new Error("book discussion has no bookId");
  }
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
  bookId: string | null;
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
  // ponytail: sections are origin-book-scoped; a shelf discussion has no
  // origin book to extract sections from, so skip the block entirely when
  // bookId is null. Attached-book block below still runs.
  let sectionBlock = "";
  if (sectionAttachments.length > 0 && discussion.bookId) {
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
  // ponytail: each attached book is co-primary — its full text is re-sent every
  // turn AND its ToC is injected as a prefixed chapter map so the model can
  // emit cross-book deep links (#ch:<bookId>:<basename>) that the renderer
  // routes to the right book on click. The prefix is the book's EpubFile id.
  let bookBlock = "";
  if (bookAttachments.length > 0) {
    const { loadBookText, buildChapterIndex } = await import("./prompt-builder");
    const parts: string[] = [];
    for (const a of bookAttachments) {
      const ab = await db.epubFile.findUnique({
        where: { id: a.bookId! },
        select: { id: true, title: true, author: true, language: true, txtPath: true, tocJson: true },
      });
      if (!ab) continue;
      try {
        const text = await loadBookText(ab.txtPath);
        const chapterMap = buildChapterIndex(ab.tocJson, 200, ab.id);
        const mapBlock = chapterMap
          ? `\n\nChapter map for "${ab.title}" — copy these prefixed hrefs verbatim to cite this book:\n${chapterMap}`
          : "";
        parts.push(
          `Title: "${ab.title}" by ${ab.author ?? "Unknown"} (source language: ${ab.language})\n${text}${mapBlock}`
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

export interface ShelfFirstTurnEvent {
  type: "discussion" | "chunk" | "error" | "done";
  discussionId?: string;
  chunk?: string;
  error?: string;
}

/**
 * Start a shelf-scoped discussion: create a discussion with NO book and NO
 * explainer, then answer the user's opening question using context from the
 * ContextSourceStrategy (OKF in Plan 2; stub in Plan 1). The book-less analog
 * of streamBlankFirstTurn. Emits the new discussionId up front so the client
 * can pin it, then streams the assistant reply.
 */
export async function* streamShelfFirstTurn(params: {
  userId: string;
  language: string;
  tier: "regular" | "pro" | "admin";
  userMessage: string;
}): AsyncGenerator<ShelfFirstTurnEvent> {
  const { userId, language, tier, userMessage } = params;

  // ponytail: ALL pre-flight runs BEFORE the discussion row is created so a
  // missing API key or a buildContext throw can't leave a dangling discussion
  // row + orphaned user message. Order: ready → books → key → context.
  const { getContextSource } = await import("./shelf-knowledge/context-source");
  const { getAccessibleBookIds } = await import("./shelf-knowledge/access");
  const { getShelfLlmConfig } = await import("./shelf-knowledge/config");

  const source = getContextSource();
  // ponytail: surface "not ready" as a clean error event rather than a 500 —
  // e.g. wiki not yet built (Plan 2). Stub is always ready.
  if (!(await source.isReady())) {
    yield { type: "error", error: "The bookshelf knowledge base isn't built yet. An admin can build it from the admin panel." };
    return;
  }

  const accessibleBookIds = await getAccessibleBookIds(userId);
  if (accessibleBookIds.length === 0) {
    yield { type: "error", error: "Add a book to your shelf first, then ask again." };
    return;
  }

  // ponytail: resolve key before buildContext — an unconfigured shelf key bails
  // with no row written. buildContext is the heaviest step (OKF retrieval), so
  // we run it last and wrap it so a throw becomes an error event (mirroring
  // the streamChat catch below) rather than a 500.
  const { apiKey, model } = await getShelfLlmConfig();
  if (!apiKey) {
    yield { type: "error", error: "OpenRouter API key not configured" };
    return;
  }

  let ctx;
  try {
    ctx = await source.buildContext({ question: userMessage, userId, accessibleBookIds });
  } catch (err: any) {
    const message = err instanceof OpenRouterError ? err.message : "Failed to build shelf context";
    yield { type: "error", error: message };
    return;
  }

  // Pre-flight passed — now safe to persist. Shelf discussion: no book, no
  // explainer, no cache key, no passage/section.
  const discussion = await db.discussion.create({
    data: { userId, bookId: null, type: "shelf", language, tier },
  });
  yield { type: "discussion", discussionId: discussion.id };

  await db.discussionMessage.create({
    data: { discussionId: discussion.id, role: "user", content: userMessage },
  });

  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: ctx.prompt },
    { role: "user", content: userMessage },
  ];

  const { streamChat } = await import("./openrouter");
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
    data: { discussionId: discussion.id, role: "assistant", content: fullContent, modelId: model },
  });
  await db.discussion.update({ where: { id: discussion.id }, data: { updatedAt: new Date() } });

  yield { type: "done" };
}
