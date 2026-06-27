export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-guards";
import { streamFollowup, type NewDiscussionAttachment } from "@/server/services/discussions";

/**
 * POST /api/discussions/[id]/messages
 *
 * Body: { content: string, attachments?: NewDiscussionAttachment[] }
 *   attachments: sections ({type:"section", sectionHref}) or other books
 *   ({type:"book", bookId}) the user added in the composer for this turn.
 *
 * Returns SSE stream of the assistant's follow-up response. The user's
 * message is persisted immediately; the assistant's response is persisted
 * on stream completion. `attachments` (newly-attached) are persisted as
 * DiscussionAttachment rows before generation and become permanent context.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let discussionId: string;
  let userMessage: string;
  let newAttachments: NewDiscussionAttachment[] | undefined;

  try {
    const user = await requireAuth();
    const { id } = await params;
    discussionId = id;
    const body = await request.json();
    userMessage = (body as { content?: string }).content ?? "";
    const raw = (body as { attachments?: unknown }).attachments;
    if (Array.isArray(raw)) {
      const parsed: NewDiscussionAttachment[] = [];
      for (const a of raw) {
        if (!a || typeof a !== "object") continue;
        const obj = a as Record<string, unknown>;
        if (
          obj.type === "section" &&
          typeof obj.sectionHref === "string" &&
          obj.sectionHref
        ) {
          parsed.push({ type: "section", sectionHref: obj.sectionHref });
        } else if (
          obj.type === "book" &&
          typeof obj.bookId === "string" &&
          obj.bookId
        ) {
          parsed.push({ type: "book", bookId: obj.bookId });
        }
        // Anything else is silently dropped — access/tier/size checks live in
        // the service, which streams an error event on violation.
      }
      newAttachments = parsed.length > 0 ? parsed : undefined;
    }
    void user;
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
          discussionId,
          userId: user.id,
          userMessage,
          newAttachments,
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
