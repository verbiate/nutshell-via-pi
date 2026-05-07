export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { generateExplainer, computeContentHash } from "@/server/services/explainer";
import { OpenRouterError } from "@/server/services/openrouter";
import { db } from "@/server/db";

/**
 * POST /api/explainers/generate
 *
 * Body: { bookId: string, type: "book" | "section" | "passage", language?: string, sectionHref?: string, passageText?: string, passageCfi?: string }
 *
 * Returns SSE stream. On cache hit, emits one event with the full cached content.
 * On cache miss, streams tokens from OpenRouter and caches the result on completion.
 * After successful generation, records ExplainerRequest for user history tracking.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();

    let body: {
      bookId?: string;
      type?: "book" | "section" | "passage";
      language?: string;
      sectionHref?: string;
      passageText?: string;
      passageCfi?: string;
    };
    try {
      body = await request.json();
    } catch {
      return new Response(
        `data: ${JSON.stringify({ error: "Invalid JSON body" })}\n\n`,
        { status: 400, headers: { "Content-Type": "text/event-stream" } }
      );
    }

    const { bookId, type, language, sectionHref, passageText, passageCfi } = body;
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
        `data: ${JSON.stringify({ error: "sectionHref is required for section type" })}\n\n`,
        { status: 400, headers: { "Content-Type": "text/event-stream" } }
      );
    }

    if (type === "passage" && !passageText) {
      return new Response(
        `data: ${JSON.stringify({ error: "passageText is required for passage type" })}\n\n`,
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
        let generator: AsyncGenerator<string>;

        // Helper to record ExplainerRequest after generation completes
        function recordExplainerRequest() {
n          Promise.resolve().then(async () => {
            try {
              const templateType = type ?? "book";
              const template = await db.promptTemplate.findUnique({
                where: { type: templateType },
              });
              const promptVersion = template?.version ?? 1;
              const sourceText = type === "passage" ? (passageText ?? "") : "";
              const contentHash = computeContentHash(sourceText, promptVersion, type ?? "book");

              const generatedExplainer = await db.explainer.findUnique({
                where: {
                  contentHash_language_contentType_tier: {
                    contentHash,
                    language: preferredLanguage,
                    contentType: type ?? "book",
                    tier,
                  },
                },
              });
              if (generatedExplainer) {
                await db.explainerRequest.create({
                  data: {
                    userId: user.id,
                    bookId,
                    explainerId: generatedExplainer.id,
                    passageCfi: type === "passage" ? (passageCfi ?? null) : null,
                    passageText: type === "passage" ? (passageText?.slice(0, 200) ?? null) : null,
                    sectionHref: type === "section" ? (sectionHref ?? null) : null,
                  },
                });
              }
            } catch (err) {
              console.error("[explainer/generate] Failed to record ExplainerRequest:", err);
            }
          });
        }

        try {
          generator = generateExplainer({
            bookId,
            type,
            language: preferredLanguage,
            tier,
            sectionHref,
            passageText,
          });

          const first = await generator.next();
          if (first.done) {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
n            controller.close();
n            return;
          }

          const second = await generator.next();
          if (second.done) {
            // Single chunk = cache hit
            const data = JSON.stringify({ chunk: first.value, cached: true });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
n            controller.close();
n            recordExplainerRequest();
n            return;
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
n          controller.close();
n          recordExplainerRequest();
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
