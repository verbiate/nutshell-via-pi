export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { generateExplainer } from "@/server/services/explainer";
import { OpenRouterError } from "@/server/services/openrouter";

/**
 * POST /api/explainers/generate
 *
 * Body: { bookId: string, type: "book" | "section", language?: string, sectionHref?: string }
 *
 * Returns SSE stream. On cache hit, emits one event with the full cached content.
 * On cache miss, streams tokens from OpenRouter and caches the result on completion.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();

    let body: {
      bookId?: string;
      type?: "book" | "section";
      language?: string;
      sectionHref?: string;
    };
    try {
      body = await request.json();
    } catch {
      return new Response(
        `data: ${JSON.stringify({ error: "Invalid JSON body" })}\n\n`,
        { status: 400, headers: { "Content-Type": "text/event-stream" } }
      );
    }

    const { bookId, type, language, sectionHref } = body;
    const preferredLanguage = language || user.preferredLanguage || "en";
    const tier = user.role === "pro" ? "pro" : "regular";

    if (!bookId || !type) {
      return new Response(
        `data: ${JSON.stringify({ error: "bookId and type are required" })}\n\n`,
        { status: 400, headers: { "Content-Type": "text/event-stream" } }
      );
    }

    if (type === "section" && !sectionHref) {
      return new Response(
        `data: ${JSON.stringify({ error: "sectionHref is required" })}\n\n`,
        { status: 400, headers: { "Content-Type": "text/event-stream" } }
      );
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return new Response(
        `data: ${JSON.stringify({ error: "Access denied" })}\n\n`,
        { status: 403, headers: { "Content-Type": "text/event-stream" } }
      );
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const generator = generateExplainer({
            bookId,
            type,
            language: preferredLanguage,
            tier,
            sectionHref,
          });

          const first = await generator.next();
          if (first.done) {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
            return;
          }

          const second = await generator.next();
          if (second.done) {
            // Single chunk = cache hit
            const data = JSON.stringify({ chunk: first.value, cached: true });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
            return;
          }

          // Multiple chunks = cache miss — stream all
          const data1 = JSON.stringify({ chunk: first.value, cached: false });
          controller.enqueue(encoder.encode(`data: ${data1}\n\n`));
          const data2 = JSON.stringify({ chunk: second.value, cached: false });
          controller.enqueue(encoder.encode(`data: ${data2}\n\n`));

          for await (const chunk of generator) {
            const data = JSON.stringify({ chunk, cached: false });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (err: any) {
          const message = err instanceof OpenRouterError ? err.message : "Generation failed";
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
  } catch (error: any) {
    if (error.statusCode === 401) {
      return new Response(
        `data: ${JSON.stringify({ error: "Authentication required" })}\n\n`,
        { status: 401, headers: { "Content-Type": "text/event-stream" } }
      );
    }
    console.error("[POST /api/explainers/generate]", error);
    return new Response(
      `data: ${JSON.stringify({ error: "Internal server error" })}\n\n`,
      { status: 500, headers: { "Content-Type": "text/event-stream" } }
    );
  }
}
