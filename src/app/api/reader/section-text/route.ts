import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { db } from "@/server/db";
import { extractSectionText } from "@/server/services/section-extractor";

/**
 * POST /api/reader/section-text
 *
 * Body: { bookId: string; sectionHref: string }
 *
 * Returns the plain TTS-ready text of a single EPUB section. Used by the
 * persistent audio layer when the reader is not mounted (e.g. the user is on
 * the bookshelf) or when jumping to an unrendered section from the playlist.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();

    let body: { bookId?: string; sectionHref?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { bookId, sectionHref } = body;
    if (!bookId || !sectionHref) {
      return NextResponse.json(
        { error: "bookId and sectionHref are required" },
        { status: 400 },
      );
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "You do not have access to this book" },
        { status: 403 },
      );
    }

    const book = await db.epubFile.findUnique({
      where: { id: bookId },
      select: { epubPath: true },
    });
    if (!book || !book.epubPath) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }

    const text = await extractSectionText(book.epubPath, sectionHref, {
      forTts: true,
    });

    return NextResponse.json({ text });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    if (error.statusCode === 403) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (error.message?.includes("Section not found")) {
      return NextResponse.json(
        { error: "Section not found" },
        { status: 404 },
      );
    }
    console.error("[POST /api/reader/section-text]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
