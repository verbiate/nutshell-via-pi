import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { getNotes, createNote, verifyBookAccess } from "@/server/services/reader";

/**
 * GET /api/reader/notes?bookId=xxx
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

    const notes = await getNotes(user.id, bookId);
    return NextResponse.json({ notes });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("[GET /api/reader/notes]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/reader/notes
 * Body: { bookId, body }
 * `body` is the passage-independent note text; trimmed, must be non-empty.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    let body: { bookId?: string; body?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { bookId, body: noteBody } = body;
    const trimmed = noteBody?.trim();
    if (!bookId || !trimmed) {
      return NextResponse.json({ error: "bookId and a non-empty body are required" }, { status: 400 });
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return NextResponse.json({ error: "You do not have access to this book" }, { status: 403 });
    }

    const note = await createNote(user.id, bookId, { body: trimmed });
    return NextResponse.json({ note });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("[POST /api/reader/notes]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
