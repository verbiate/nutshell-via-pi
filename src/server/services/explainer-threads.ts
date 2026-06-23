import { db } from "@/server/db";
import { OpenRouterError } from "./openrouter";
import {
  computeContentHash,
  createExplainer,
  getExplainer,
} from "./explainer";
import { recordError } from "./errors";
import { getSetting } from "./settings";

// ponytail: explainer-threads wraps the existing generateExplainer cache logic
// and adds the per-user multi-turn thread model. Initial response uses the
// same global cache (Explainer table); only follow-up turns are per-user
// (ExplainerMessage table).

export interface InitialResponseEvent {
  type: "chunk" | "cached" | "thread" | "error" | "status";
  chunk?: string;
  cached?: boolean;
  threadId?: string;
  error?: string;
  // Two-pass progress: "explaining" = hidden pass 1 running; "refining" =
  // streamed pass 2 running. Only emitted for book type when the
  // bookTwoPassEnabled setting is on.
  stage?: "explaining" | "refining";
}

export interface CreateThreadParams {
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
 * Stream the initial response for a new thread. Reuses the existing
 * prompt-builder + cache (Explainer table) so cache hits are instant.
 * On completion, upserts an ExplainerThread and yields its id.
 */
export async function* streamInitialThreadResponse(
  params: CreateThreadParams
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

  // ponytail: combined salt — two-pass discriminator + metadata version. Both
  // are optional; when neither applies the salt is undefined (matches legacy
  // one-pass-no-metadata behavior). Order is deterministic so the hash is
  // stable across requests for the same inputs.
  const parts: string[] = [];
  if (twoPass) parts.push(`twoPass:${pass2Version}`);
  if (promptData.metadataVersion) parts.push(`meta:${promptData.metadataVersion}`);
  const extraSalt = parts.length > 0 ? parts.join("|") : undefined;

  const contentHash = computeContentHash(
    promptData.sourceText,
    promptData.promptVersion,
    type,
    type === "section" || type === "passage" ? promptData.bookMd5 : undefined,
    extraSalt
  );

  // Check cache (shared across all users)
  const cached = await getExplainer({ contentHash, language, contentType: type, tier });

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
        const existing = await getExplainer({
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

  // Upsert thread (one per user + explainer)
  const thread = await db.explainerThread.upsert({
    where: { userId_explainerId: { userId, explainerId } },
    create: {
      userId,
      bookId,
      explainerId,
      type,
      passageCfi: params.passageCfi,
      passageText: params.passageText,
      sectionHref: params.sectionHref,
      language,
      tier,
    },
    update: {}, // touch only; createdAt/updatedAt handle themselves
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

  yield { type: "thread", threadId: thread.id, cached: cachedFlag };
}

/**
 * Build the prompt and source text for the given params. Thin wrapper around
 * the existing prompt-builder functions.
 */
async function buildPromptData(params: CreateThreadParams): Promise<{
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

/**
 * List a user's threads for a book, newest first.
 */
export async function listThreadsForBook(userId: string, bookId: string) {
  return db.explainerThread.findMany({
    where: { userId, bookId },
    include: {
      explainer: { select: { id: true, content: true, modelId: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Delete a thread and its messages. Ownership-checked (matches the bookmark
 * and highlight delete pattern).
 */
export async function deleteThread(userId: string, threadId: string) {
  const thread = await db.explainerThread.findUnique({
    where: { id: threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== userId) {
    throw new Error("Thread not found or access denied");
  }
  await db.explainerThread.delete({ where: { id: threadId } });
}

/**
 * Get a thread with its messages (ownership-checked).
 */
export async function getThreadWithMessages(threadId: string, userId: string) {
  const thread = await db.explainerThread.findUnique({
    where: { id: threadId },
    include: {
      explainer: { select: { content: true, modelId: true, promptVersion: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!thread || thread.userId !== userId) return null;
  return thread;
}

export interface FollowupEvent {
  type: "chunk" | "done" | "error";
  chunk?: string;
  error?: string;
}

/**
 * Stream a follow-up response in an existing thread. Persists the user's
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
 * model has full context regardless of how long the thread grows.
 */
export async function* streamFollowup(params: {
  threadId: string;
  userId: string;
  userMessage: string;
}): AsyncGenerator<FollowupEvent> {
  const thread = await db.explainerThread.findUnique({
    where: { id: params.threadId },
    include: {
      explainer: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!thread || thread.userId !== params.userId) {
    yield { type: "error", error: "Thread not found" };
    return;
  }

  // Save the user's message immediately (even if streaming fails later —
  // the user's intent is preserved).
  await db.explainerMessage.create({
    data: {
      threadId: thread.id,
      role: "user",
      content: params.userMessage,
    },
  });

  // Build the system message by re-filling the template with the source text.
  // ponytail: we stored passageText/sectionHref in the thread row at creation
  // so we can rebuild the prompt without re-reading the book.
  const systemPrompt = await rebuildSystemPrompt(thread);

  // Compose messages array
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    { role: "assistant", content: thread.explainer.content },
  ];
  for (const m of thread.messages) {
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: "user", content: params.userMessage });

  // Resolve current tier model + key (per ponytail decision: follow-ups use
  // the user's CURRENT tier config, not frozen-from-initial-response).
  const { streamChat, getOpenRouterConfig } = await import("./openrouter");
  const { apiKey, model } = await getOpenRouterConfig(thread.tier);
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
  await db.explainerMessage.create({
    data: {
      threadId: thread.id,
      role: "assistant",
      content: fullContent,
      modelId: model,
    },
  });

  // Touch the thread's updatedAt so it bubbles to top of the list
  await db.explainerThread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date() },
  });

  yield { type: "done" };
}

/**
 * Rebuild the system prompt for a thread by re-running the appropriate
 * prompt-builder. We need the original source text in the prompt so the
 * model has context for follow-up questions.
 */
async function rebuildSystemPrompt(thread: {
  type: string;
  bookId: string;
  language: string;
  passageText: string | null;
  sectionHref: string | null;
}): Promise<string> {
  if (thread.type === "passage") {
    if (!thread.passageText) {
      throw new Error("Thread has no passageText to rebuild prompt");
    }
    const { buildPassagePrompt } = await import("./prompt-builder");
    const data = await buildPassagePrompt(
      thread.bookId,
      thread.passageText,
      thread.language
    );
    return data.prompt;
  }
  if (thread.type === "section") {
    if (!thread.sectionHref) {
      throw new Error("Thread has no sectionHref to rebuild prompt");
    }
    const { buildSectionPrompt } = await import("./prompt-builder");
    const data = await buildSectionPrompt(
      thread.bookId,
      thread.sectionHref,
      thread.language
    );
    return data.prompt;
  }
  // book
  const { buildBookPrompt } = await import("./prompt-builder");
  const data = await buildBookPrompt(thread.bookId, thread.language);
  return data.prompt;
}
