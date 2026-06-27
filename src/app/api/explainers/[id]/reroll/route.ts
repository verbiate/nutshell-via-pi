export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth-guards";
import { rerollExplainer } from "@/server/services/discussions";

/**
 * POST /api/explainers/[id]/reroll  (admin-only, SSE)
 *
 * `[id]` is an explainer id. Regenerates that explainer as a NEW version of
 * its cache key (identical inputs, fresh LLM output). Streams the generation,
 * then a final `version` event with the new version number + explainer id.
 * Existing discussions keep their pinned version; new discussions get this one.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAdmin();
    const { id } = await params;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of rerollExplainer({
            explainerId: id,
            actorId: user.id,
          })) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            if (event.type === "error") break;
          }
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (err: any) {
          const data = JSON.stringify({
            type: "error",
            error: err.message || "Reroll failed",
          });
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
    if (error.statusCode === 401) return sseError("Authentication required", 401);
    if (error.statusCode === 403) return sseError("Admin access required", 403);
    return sseError("Internal server error", 500);
  }
}

function sseError(message: string, status: number) {
  return new Response(
    `data: ${JSON.stringify({ type: "error", error: message })}\n\n`,
    { status, headers: { "Content-Type": "text/event-stream" } }
  );
}
