import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { db } from "@/server/db";

/**
 * GET /api/explainers/history?bookId=xxx
 *
 * Returns all Explainers the current user has generated for this book,
 * ordered by createdAt descending (newest first).
 * Queries via the ExplainerRequest junction table and JOINs Explainer for content.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get("bookId");

    if (!bookId) {
      return NextResponse.json({ error: "bookId is required" }, { status: 400 });
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return NextResponse.json({ error: "You do not have access to this book" }, { status: 403 });
    }

    const book = await db.epubFile.findUnique({
      where: { id: bookId },
      select: { title: true, tocJson: true },
    });
    if (!book) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }

    const requests = await db.explainerRequest.findMany({
      where: { userId: user.id, bookId },
      orderBy: { createdAt: "desc" },
      include: { explainer: true },
    });

    const toc = book.tocJson ? (JSON.parse(book.tocJson) as Array<{ label: string; href: string }>) : [];

    const entries = requests.map((req) => {
      const explainer = req.explainer;
      let targetLabel: string;

      if (explainer.contentType === "book") {
        targetLabel = book.title;
      } else if (explainer.contentType === "section") {
        const tocEntry = toc.find((t) => t.href === req.sectionHref);
        targetLabel = tocEntry?.label ?? "Section";
      } else {
        // passage
        targetLabel = req.passageText ? `"${req.passageText.slice(0, 60)}..."` : "Selected passage";
      }

      return {
        id: req.id,
        explainerId: explainer.id,
        contentType: explainer.contentType,
        tier: explainer.tier,
        language: explainer.language,
        targetLabel,
        passageCfi: req.passageCfi,
        sectionHref: req.sectionHref,
        createdAt: req.createdAt,
        content: explainer.content,
      };
    });

    return NextResponse.json({ explainers: entries });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("[GET /api/explainers/history]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
