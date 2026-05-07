import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { getBookmarks, createBookmark, verifyBookAccess } from "@/server/services/reader";

/**
 * GET /api/reader/bookmarks?bookId=xxx
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

    const bookmarks = await getBookmarks(user.id, bookId);
    return NextResponse.json({ bookmarks });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("[GET /api/reader/bookmarks]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/reader/bookmarks
 * Body: { bookId, cfi, paragraphIndex, charOffset, selectedText?, note? }
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    let body: {
      bookId?: string;
      cfi?: string;
      paragraphIndex?: number;
      charOffset?: number;
      selectedText?: string;
      note?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { bookId, cfi, paragraphIndex, charOffset, selectedText, note } = body;
    if (!bookId || !cfi || paragraphIndex === undefined || charOffset === undefined) {
      return NextResponse.json({ error: "bookId, cfi, paragraphIndex, and charOffset are required" }, { status: 400 });
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return NextResponse.json({ error: "You do not have access to this book" }, { status: 403 });
    }

    const bookmark = await createBookmark(user.id, bookId, {
      cfi,
      paragraphIndex,
      charOffset,
      selectedText,
      note,
    });

    return NextResponse.json({ bookmark });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("[POST /api/reader/bookmarks]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
