export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import {
  streamInitialThreadResponse,
  streamBlankFirstTurn,
  listThreadsForBook,
} from "@/server/services/explainer-threads";

/**
 * POST /api/explainers/threads
 *
 * Two modes:
 *  1. Seeded ("Ask about this"): { bookId, type, passageText?/sectionHref?, language? }
 *     — generates (or serves cached) the explainer as the first response.
 *  2. Blank ("New discussion"):  { bookId, type: "book", message, language? }
 *     — creates a thread with NO explainer and answers the user's opening
 *       question with the book as context. Emits `thread` then `chunk`s.
 *
 * GET /api/explainers/threads?bookId=X — list user's threads for a book.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const {
      bookId,
      type,
      passageText,
      passageCfi,
      sectionHref,
      language,
      message,
    } = body as {
      bookId?: string;
      type?: "passage" | "section" | "book";
      passageText?: string;
      passageCfi?: string;
      sectionHref?: string;
      language?: string;
      message?: string;
    };

    if (!bookId || !type) {
      return sseError("bookId and type are required", 400);
    }
    if (!["passage", "section", "book"].includes(type)) {
      return sseError("type must be passage, section, or book", 400);
    }
    // Seeded-mode field validation (runs before the access check so a bad
    // request is 400, not 403 — matches existing endpoint contract).
    if (type === "passage" && !passageText) {
      return sseError("passageText is required for passage type", 400);
    }
    if (type === "section" && !sectionHref) {
      return sseError("sectionHref is required for section type", 400);
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) return sseError("Access denied", 403);

    const preferredLanguage = language || user.preferredLanguage || "en";
    // ponytail: respect the user's actual tier (regular/pro/admin). Previously
    // collapsed admin→regular, which billed admin requests to the regular
    // tier's API key and used its model — wrong since admin/pro/regular each
    // have their own OpenRouterConfig row.
    const tier = user.role as "regular" | "pro" | "admin";

    // Blank "New discussion" first turn — no explainer generation.
    if (message !== undefined) {
      if (typeof message !== "string" || !message.trim()) {
        return sseError("message must be a non-empty string", 400);
      }
      if (type !== "book") {
        return sseError("blank discussions are book-level only", 400);
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const event of streamBlankFirstTurn({
              userId: user.id,
              bookId,
              language: preferredLanguage,
              tier,
              userMessage: message,
            })) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
              );
              if (event.type === "error") break;
            }
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          } catch (err: any) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", error: err.message || "Generation failed" })}\n\n`
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

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of streamInitialThreadResponse({
            userId: user.id,
            bookId,
            type,
            passageText,
            passageCfi,
            sectionHref,
            language: preferredLanguage,
            tier,
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
            error: err.message || "Generation failed",
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
    if (error.statusCode === 403) return sseError("Access denied", 403);
    return sseError("Internal server error", 500);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get("bookId");
    if (!bookId) {
      return Response.json(
        { error: "bookId query param is required" },
        { status: 400 }
      );
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }

    const threads = await listThreadsForBook(user.id, bookId);
    return Response.json({ threads });
  } catch (error: any) {
    if (error.statusCode === 401)
      return Response.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403)
      return Response.json({ error: "Access denied" }, { status: 403 });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

function sseError(message: string, status: number) {
  return new Response(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}
