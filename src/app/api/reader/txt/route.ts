import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { db } from "@/server/db";
import { storage } from "@/server/storage/local";

/**
 * GET /api/reader/txt?bookId=xxx
 *
 * Returns the TXT conversion of a book for client-side search.
 * Returns 403 if user lacks access, 404 if book or TXT not found.
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
      select: { txtPath: true },
    });
    if (!book || !book.txtPath) {
      return NextResponse.json({ error: "Book or TXT not found" }, { status: 404 });
    }

    const txtBuffer = await storage.read(book.txtPath);
    const text = txtBuffer.toString("utf-8");

    return NextResponse.json({ text });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("[GET /api/reader/txt]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
