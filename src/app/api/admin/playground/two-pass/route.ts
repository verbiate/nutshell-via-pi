export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth-guards";
import {
  getOpenRouterConfig,
  OpenRouterError,
  streamBookTwoPass,
} from "@/server/services/openrouter";
import {
  buildChapterIndex,
  fillTemplate,
  formatExpandedMetadata,
} from "@/server/services/prompt-builder";
import { db } from "@/server/db";
import { storage } from "@/server/storage/local";

/**
 * POST /api/admin/playground/two-pass
 *
 * Single-shot two-pass book explainer audition. Mirrors the production
 * streamBookTwoPass flow: pass 1 (book template) runs hidden; pass 2
 * (book_pass2 template, filled with {{previous_response}}) streams to client.
 *
 * Body: {
 *   tier: "regular" | "pro" | "admin",
 *   model?: string,
 *   bookId: string,                    // REQUIRED — exactly one book
 *   targetLanguage?: string,           // 2-char code, default "en"
 *   promptOverrides?: {
 *     book?: string,                   // filled for pass 1 (else saved)
 *     book_pass2?: string,             // filled for pass 2 (else saved)
 *   }
 * }
 *
 * Each pass uses streamExplainer internally, which injects the production
 * EXPLAINER_SYSTEM_MESSAGE as the system persona. The Playground's
 * system-prompt override does NOT apply in two-pass mode — that's a known
 * limitation. To audition a custom system prompt, use single-pass discussion.
 *
 * Returns SSE stream:
 *   data: {"type":"status","stage":"explaining"}\n\n
 *   data: {"type":"status","stage":"refining"}\n\n
 *   data: {"type":"chunk","chunk":"..."}\n\n   (pass-2 chunks only)
 *   data: [DONE]\n\n
 * Errors: data: {"type":"error","error":"..."}\n\n
 */
export async function POST(request: Request) {
  let tier: string;
  let customModel: string | undefined;
  let bookId: string | undefined;
  let targetLanguage: string | undefined;
  let bookOverride: string | undefined;
  let bookPass2Override: string | undefined;

  try {
    const admin = await requireAdmin();
    void admin;
    const body = await request.json();
    tier = body.tier;
    customModel = body.model;
    bookId = body.bookId;
    targetLanguage = body.targetLanguage;
    bookOverride = body.promptOverrides?.book;
    bookPass2Override = body.promptOverrides?.book_pass2;
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
  if (!bookId) {
    return sseError("bookId is required for two-pass", 400);
  }
  const lang = targetLanguage && /^[a-z]{2}$/.test(targetLanguage)
    ? targetLanguage
    : "en";

  // Resolve model + key (admin tier always pays).
  const { apiKey } = await getOpenRouterConfig("admin");
  if (!apiKey) {
    return sseError("No API key configured for admin tier", 500);
  }
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

  // Load book + plaintext.
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
  if (!book.txtPath) {
    return sseError("Attached book has no plaintext (txtPath missing)", 400);
  }
  let bookText: string;
  try {
    bookText = (await storage.read(book.txtPath)).toString("utf-8");
  } catch {
    return sseError("Failed to read attached book's plaintext", 500);
  }
  if (!bookText.trim()) {
    return sseError("Attached book has empty plaintext", 400);
  }

  // Resolve templates: override wins, else saved fallback.
  const saved = await db.promptTemplate.findMany({
    where: { type: { in: ["book", "book_pass2"] } },
    select: { type: true, content: true },
  });
  const savedByType: Record<string, string> = {};
  for (const t of saved) savedByType[t.type] = t.content;

  const bookTemplate = bookOverride?.trim() || savedByType.book || null;
  const pass2Template =
    bookPass2Override?.trim() || savedByType.book_pass2 || null;
  if (!bookTemplate) {
    return sseError("No book template available (override or saved)", 400);
  }
  if (!pass2Template) {
    return sseError(
      "No book_pass2 template available (override or saved). Seed it on /admin/prompts first.",
      400
    );
  }

  // Fill pass-1 prompt with the same vars buildBookPrompt uses.
  const templateVars = {
    title: book.title,
    author: book.author ?? "Unknown",
    language: book.language ?? "en",
    target_language: lang,
    book_text: bookText,
    text: bookText,
    expanded_metadata: formatExpandedMetadata(book.bookMetadata),
    chapter_index: buildChapterIndex(book.tocJson),
  };
  const pass1Prompt = fillTemplate(bookTemplate, templateVars);

  // ponytail: hand streamBookTwoPass a builder that fills {{previous_response}}
  // (pass-1's accumulated output) + {{book_text}} etc. Reuses the production
  // token-pattern wiring. Each pass uses streamExplainer internally, so the
  // production EXPLAINER_SYSTEM_MESSAGE is the system persona on both passes.
  const buildPass2Prompt = (pass1Response: string) =>
    fillTemplate(pass2Template, {
      ...templateVars,
      previous_response: pass1Response,
    });

  // Book explainers run hotter on tokens — match production's 4096.
  const maxTokens = 4096;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const evt of streamBookTwoPass({
          pass1Prompt,
          buildPass2Prompt,
          apiKey,
          model,
          maxTokens,
        })) {
          if (evt.type === "status" && evt.stage) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "status", stage: evt.stage })}\n\n`
              )
            );
          } else if (evt.type === "chunk" && evt.chunk) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "chunk", chunk: evt.chunk })}\n\n`
              )
            );
          }
        }
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err: any) {
        const message =
          err instanceof OpenRouterError ? err.message : "Two-pass failed";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: message })}\n\n`
          )
        );
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
  return new Response(
    `data: ${JSON.stringify({ type: "error", error: message })}\n\n`,
    {
      status,
      headers: { "Content-Type": "text/event-stream" },
    }
  );
}
