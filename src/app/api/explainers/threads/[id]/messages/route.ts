export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-guards";
import { streamFollowup } from "@/server/services/explainer-threads";

/**
 * POST /api/explainers/threads/[id]/messages
 *
 * Body: { content: string }
 *
 * Returns SSE stream of the assistant's follow-up response. The user's
 * message is persisted immediately; the assistant's response is persisted
 * on stream completion.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let threadId: string;
  let userMessage: string;

  try {
    const user = await requireAuth();
    const { id } = await params;
    threadId = id;
    const body = await request.json();
    userMessage = (body as { content?: string }).content ?? "";
  } catch (error: any) {
    if (error.statusCode === 401) return sseError("Authentication required", 401);
    if (error.statusCode === 403) return sseError("Access denied", 403);
    return sseError("Invalid request body", 400);
  }

  if (!userMessage.trim()) {
    return sseError("content is required", 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // ponytail: we need the user.id but auth was already checked above; we
      // re-call requireAuth here because the first one was in a different
      // scope. Could refactor to thread the user through, but cheap.
      try {
        const user = await requireAuth();
        for await (const event of streamFollowup({
          threadId,
          userId: user.id,
          userMessage,
        })) {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          if (event.type === "error") break;
        }
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err: any) {
        const data = JSON.stringify({
          type: "error",
          error: err.message || "Follow-up failed",
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
}

function sseError(message: string, status: number) {
  return new Response(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}
