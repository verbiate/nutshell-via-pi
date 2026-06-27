export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth-guards";
import { getOpenRouterConfig, OpenRouterError, streamChat } from "@/server/services/openrouter";
import {
  buildChapterIndex,
  fillTemplate,
  formatExpandedMetadata,
} from "@/server/services/prompt-builder";
import { db } from "@/server/db";
import { storage } from "@/server/storage/local";

/**
 * POST /api/admin/playground/chat
 *
 * Body: {
 *   tier: "regular" | "pro" | "admin",
 *   model?: string,            // custom override; ignored for key resolution (always admin)
 *   systemPrompt?: string,     // DEPRECATED: replaced by promptOverrides.system (still accepted for back-compat)
 *   targetLanguage?: string,   // 2-char code, default "en" — fills {{target_language}} in templates
 *   messages: { role: "user" | "assistant", content: string }[],
 *   bookIds?: string[],        // AT MOST ONE book — Playground fills the book template per call
 *   promptOverrides?: {
 *     system?: string,         // wired — sent as system message when non-empty
 *     book?: string,           // wired — filled per attached book and sent as system message
 *     section?: string,        // accepted, NOT wired (silently ignored)
 *     passage?: string,        // accepted, NOT wired
 *     book_pass2?: string      // accepted, NOT wired
 *   }
 * }
 *
 * Resolution (admin is the one testing — billing always to admin key):
 *   - apiKey: always from Admin tier's OpenRouterConfig
 *   - model: custom `model` if provided, else the selected tier's configured model
 *
 * Message order: [book system msg if book attached] → [system override if non-empty]
 *                → conversation.
 *
 * When a book is attached, the (overridden or saved) book template is filled
 * with that book's metadata + plaintext using fillTemplate — REPLACING the old
 * `[Book: title]\n<text>` shortcut. Fall back to the shortcut only when no
 * saved book template AND no override (so fresh installs still work).
 *
 * Returns SSE stream: `data: {"chunk": "..."}\n\n` events terminated by
 * `data: [DONE]\n\n`. Errors emitted as `data: {"error": "..."}\n\n`.
 */
export async function POST(request: Request) {
  let tier: string;
  let customModel: string | undefined;
  let systemPrompt: string | undefined;
  let targetLanguage: string | undefined;
  let messages: { role: "user" | "assistant"; content: string }[];
  let bookIds: string[] | undefined;
  let promptOverrides: {
    system?: string;
    book?: string;
    section?: string;
    passage?: string;
    book_pass2?: string;
  } = {};

  // ponytail: auth-first parse pattern copied from api/explainers/generate/route.ts —
  // bad JSON returns an SSE error response (not JSON) so the client's stream
  // reader always sees a uniform error shape.
  try {
    const admin = await requireAdmin();
    void admin; // admin auth required; the key comes from the admin tier's config row
    const body = await request.json();
    tier = body.tier;
    customModel = body.model;
    systemPrompt = body.systemPrompt;
    targetLanguage = body.targetLanguage;
    messages = body.messages;
    bookIds = body.bookIds;
    promptOverrides = body.promptOverrides ?? {};
  } catch (error: any) {
    if (error.statusCode === 401)
      return sseError("Authentication required", 401);
    if (error.statusCode === 403)
      return sseError("Admin access required", 403);
    return sseError(error.message || "Invalid request body", 400);
  }

  if (!tier || !["regular", "pro", "admin"].includes(tier)) {
    return sseError("tier must be regular, pro, or admin", 400);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return sseError("messages must be a non-empty array", 400);
  }
  // ponytail: Playground supports at most one attached book. Filling the book
  // template per attached book is meaningful for one book; multi-book template
  // fill is a future task. Hard-cap here so the UI constraint can't be bypassed.
  if (bookIds && bookIds.length > 1) {
    return sseError("Playground supports at most one attached book", 400);
  }
  // Validate targetLanguage if provided: 2-char lowercase, matches LANGUAGES pattern.
  const lang = targetLanguage && /^[a-z]{2}$/.test(targetLanguage)
    ? targetLanguage
    : "en";

  // Admin tier supplies the API key — the admin is doing the testing, so the
  // bill always lands on the admin key regardless of which tier's model is picked.
  const { apiKey } = await getOpenRouterConfig("admin");
  if (!apiKey) {
    return sseError("No API key configured for admin tier", 500);
  }

  // Resolve model: custom override wins, else the selected tier's configured model.
  let model: string;
  if (customModel && customModel.trim()) {
    model = customModel.trim();
  } else {
    const tierConfig = await getOpenRouterConfig(tier);
    if (!tierConfig.model) {
      return sseError(`No model configured for ${tier} tier`, 400);
    }
    model = tierConfig.model;
  }

  // Build the per-book system message. When a book template (override or saved)
  // is in play, fill it via fillTemplate with the same vars buildBookPrompt uses.
  // Fall back to the legacy [Book: ...] format only when no template is available.
  const contextMessages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (bookIds && bookIds.length > 0) {
    const bookId = bookIds[0];
    const book = await db.epubFile.findUnique({
      where: { id: bookId },
      select: {
        txtPath: true,
        title: true,
        author: true,
        language: true,
        tocJson: true,
        bookMetadata: true,
      },
    });
    if (!book) {
      return sseError(`Book not found: ${bookId}`, 400);
    }
    if (book.txtPath) {
      try {
        const bookText = (await storage.read(book.txtPath)).toString("utf-8");
        if (bookText.trim()) {
          const overrideContent = promptOverrides.book?.trim();
          let templateContent: string | null = overrideContent || null;
          if (!templateContent) {
            const saved = await db.promptTemplate.findUnique({
              where: { type: "book" },
              select: { content: true },
            });
            templateContent = saved?.content ?? null;
          }
          if (templateContent) {
            const filled = fillTemplate(templateContent, {
              title: book.title,
              author: book.author ?? "Unknown",
              language: book.language ?? "en",
              target_language: lang,
              book_text: bookText,
              text: bookText,
              expanded_metadata: formatExpandedMetadata(book.bookMetadata),
              chapter_index: buildChapterIndex(book.tocJson),
            });
            contextMessages.push({ role: "system", content: filled });
          } else {
            // Legacy fallback for fresh installs without a seeded book template.
            const header = book.author
              ? `[Book: ${book.title} by ${book.author}]`
              : `[Book: ${book.title}]`;
            contextMessages.push({ role: "system", content: `${header}\n${bookText}` });
          }
        }
      } catch {
        // Skip unreadable txt — don't fail the whole request
      }
    }
  }

  // Build final messages array: [book system msg] → [system override] → conversation.
  // systemPrompt (top-level, deprecated) is kept as a fallback for any caller
  // that hasn't migrated to promptOverrides.system yet.
  const finalMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    ...contextMessages,
  ];
  const systemOverride = promptOverrides.system?.trim() || systemPrompt?.trim();
  if (systemOverride) {
    finalMessages.push({ role: "system", content: systemOverride });
  }
  for (const m of messages) {
    finalMessages.push({ role: m.role, content: m.content });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamChat({
          apiKey,
          model,
          messages: finalMessages,
        })) {
          const data = JSON.stringify({ chunk });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err: any) {
        const message =
          err instanceof OpenRouterError ? err.message : "Chat failed";
        const data = JSON.stringify({ error: message });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function sseError(message: string, status: number) {
  return new Response(`data: ${JSON.stringify({ error: message })}\n\n`, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}
