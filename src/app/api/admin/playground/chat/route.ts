export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth-guards";
import { getOpenRouterConfig, OpenRouterError, streamChat } from "@/server/services/openrouter";
import { db } from "@/server/db";
import { storage } from "@/server/storage/local";

/**
 * POST /api/admin/playground/chat
 *
 * Body: {
 *   tier: "regular" | "pro" | "admin",
 *   model?: string,            // custom override; ignored for key resolution (always admin)
 *   systemPrompt?: string,
 *   messages: { role: "user" | "assistant", content: string }[],
 *   bookIds?: string[]         // selected books injected as system messages
 * }
 *
 * Resolution (admin is the one testing — billing always to admin key):
 *   - apiKey: always from Admin tier's OpenRouterConfig
 *   - model: custom `model` if provided, else the selected tier's configured model
 *
 * Message order: [book system messages...] → [user systemPrompt if set] → conversation.
 *
 * Returns SSE stream: `data: {"chunk": "..."}\n\n` events terminated by
 * `data: [DONE]\n\n`. Errors emitted as `data: {"error": "..."}\n\n`.
 */
export async function POST(request: Request) {
  let tier: string;
  let customModel: string | undefined;
  let systemPrompt: string | undefined;
  let messages: { role: "user" | "assistant"; content: string }[];
  let bookIds: string[] | undefined;

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
    messages = body.messages;
    bookIds = body.bookIds;
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

  // Read selected books' plaintext and inject as system messages.
  // ponytail: read fresh on every send (no cache). Admin may have swapped the
  // underlying file; disk is cheap, correctness matters more than the ~3 reads.
  const contextMessages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (bookIds && bookIds.length > 0) {
    for (const bookId of bookIds) {
      const book = await db.epubFile.findUnique({
        where: { id: bookId },
        select: { txtPath: true, title: true, author: true },
      });
      if (!book) {
        return sseError(`Book not found: ${bookId}`, 400);
      }
      if (!book.txtPath) continue; // skip silently — no plaintext available
      try {
        const text = (await storage.read(book.txtPath)).toString("utf-8");
        if (text.trim()) {
          const header = book.author
            ? `[Book: ${book.title} by ${book.author}]`
            : `[Book: ${book.title}]`;
          contextMessages.push({ role: "system", content: `${header}\n${text}` });
        }
      } catch {
        // Skip unreadable txt — don't fail the whole request
      }
    }
  }

  // Build final messages array: [book system msgs] → [user systemPrompt if set] → conversation
  const finalMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    ...contextMessages,
  ];
  if (systemPrompt && systemPrompt.trim()) {
    finalMessages.push({ role: "system", content: systemPrompt });
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
