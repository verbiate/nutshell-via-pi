export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import {
  streamInitialDiscussionResponse,
  streamBlankFirstTurn,
  listDiscussionsForBook,
  listAllDiscussionsForUser,
  type NewDiscussionAttachment,
} from "@/server/services/discussions";

/**
 * POST /api/discussions
 *
 * Two modes:
 *  1. Seeded ("Ask about this"): { bookId, type, passageText?/sectionHref?, language? }
 *     — generates (or serves cached) the explainer as the first response.
 *  2. Blank ("New discussion"):  { bookId, type: "book", message, language? }
 *     — creates a discussion with NO explainer and answers the user's opening
 *       question with the book as context. Emits `discussion` then `chunk`s.
 *
 * GET /api/discussions?bookId=X — list user's discussions for a book.
 * GET /api/discussions             — list ALL of the user's discussions
 *                                    across every book (homepage tab).
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
      attachments: rawAttachments,
    } = body as {
      bookId?: string;
      type?: "passage" | "section" | "book" | "shelf";
      passageText?: string;
      passageCfi?: string;
      sectionHref?: string;
      language?: string;
      message?: string;
      attachments?: unknown;
    };

    if (!type) {
      return sseError("type is required", 400);
    }
    if (!["passage", "section", "book", "shelf"].includes(type)) {
      return sseError("type must be passage, section, book, or shelf", 400);
    }
    // Shelf discussions require a message (the opening question) — blank-mode
    // is the only shelf mode. Guard before any streaming branch.
    if (
      type === "shelf" &&
      (typeof message !== "string" || !message.trim())
    ) {
      return sseError("message is required for shelf type", 400);
    }
    // ponytail: shelf discussions are book-less — no single bookId, no
    // verifyBookAccess. Per-book access is enforced inside the context source
    // via the user's UserBookAccess-derived set (see getAccessibleBookIds).
    if (type !== "shelf") {
      if (!bookId) {
        return sseError("bookId is required for passage/section/book types", 400);
      }
      if (type === "passage" && !passageText) {
        return sseError("passageText is required for passage type", 400);
      }
      if (type === "section" && !sectionHref) {
        return sseError("sectionHref is required for section type", 400);
      }
      const hasAccess = await verifyBookAccess(user.id, bookId);
      if (!hasAccess) return sseError("Access denied", 403);
    }

    const preferredLanguage = language || user.preferredLanguage || "en";
    // ponytail: respect the user's actual tier (regular/pro/admin). Previously
    // collapsed admin→regular, which billed admin requests to the regular
    // tier's API key and used its model — wrong since admin/pro/regular each
    // have their own OpenRouterConfig row.
    const tier = user.role as "regular" | "pro" | "admin";

    // ponytail: parse attachments (allow-list section/book) so a blank "New
    // discussion" can launch with attached context. Mirrors the /messages route.
    // Seeded mode ignores attachments — explainer generation is its own flow.
    let newAttachments: NewDiscussionAttachment[] | undefined;
    if (Array.isArray(rawAttachments)) {
      const parsed: NewDiscussionAttachment[] = [];
      for (const a of rawAttachments) {
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

    // Blank "New discussion" first turn — no explainer generation.
    if (message !== undefined) {
      if (typeof message !== "string" || !message.trim()) {
        return sseError("message must be a non-empty string", 400);
      }
      if (type !== "book" && type !== "shelf") {
        return sseError("blank discussions are book- or shelf-level only", 400);
      }

      // Shelf discussions have their own book-less first-turn stream.
      if (type === "shelf") {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              const { streamShelfFirstTurn } = await import(
                "@/server/services/discussions"
              );
              for await (const event of streamShelfFirstTurn({
                userId: user.id,
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
            for await (const event of streamBlankFirstTurn({
              userId: user.id,
              bookId: bookId!,
              language: preferredLanguage,
              tier,
              userMessage: message,
              newAttachments,
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
          for await (const event of streamInitialDiscussionResponse({
            userId: user.id,
            bookId: bookId!,
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

    // ponytail: no bookId → list every discussion this user owns, across all
    // their books. Used by the homepage Discussions tab. No per-book access
    // check needed — `where: { userId }` already scopes ownership.
    if (!bookId) {
      const discussions = await listAllDiscussionsForUser(user.id);
      return Response.json({ discussions });
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }

    const discussions = await listDiscussionsForBook(user.id, bookId);
    return Response.json({ discussions });
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
