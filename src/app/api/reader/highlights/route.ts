import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { getHighlights, createHighlight, verifyBookAccess } from "@/server/services/reader";

/**
 * GET /api/reader/highlights?bookId=xxx
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

    const highlights = await getHighlights(user.id, bookId);
    return NextResponse.json({ highlights });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("[GET /api/reader/highlights]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/reader/highlights
 * Body: { bookId, cfi, paragraphIndex, charOffsetStart, charOffsetEnd, selectedText, color?, note? }
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    let body: {
      bookId?: string;
      cfi?: string;
      paragraphIndex?: number;
      charOffsetStart?: number;
      charOffsetEnd?: number;
      selectedText?: string;
      color?: string;
      sectionHref?: string;
      note?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { bookId, cfi, paragraphIndex, charOffsetStart, charOffsetEnd, selectedText, color, sectionHref, note } = body;
    if (!bookId || !cfi || paragraphIndex === undefined || charOffsetStart === undefined || charOffsetEnd === undefined || !selectedText) {
      return NextResponse.json({ error: "bookId, cfi, paragraphIndex, charOffsetStart, charOffsetEnd, and selectedText are required" }, { status: 400 });
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return NextResponse.json({ error: "You do not have access to this book" }, { status: 403 });
    }

    const highlight = await createHighlight(user.id, bookId, {
      cfi,
      paragraphIndex,
      charOffsetStart,
      charOffsetEnd,
      selectedText,
      color,
      sectionHref,
      note,
    });

    return NextResponse.json({ highlight });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("[POST /api/reader/highlights]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
