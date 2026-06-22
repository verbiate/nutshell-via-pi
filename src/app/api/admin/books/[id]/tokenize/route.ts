export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { countTokens } from "@/server/services/tokens";

/**
 * POST /api/admin/books/[id]/tokenize
 *
 * Lazy backfill: reads the book's plaintext from storage, tokenizes it
 * (cl100k_base), persists the result to EpubFile.txtTokens, returns the count.
 * Idempotent — if txtTokens is already set, returns the cached value without
 * re-reading the file. Admin-only.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    if (error.statusCode === 403)
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }

  const { id } = await params;

  const book = await db.epubFile.findUnique({
    where: { id },
    select: { txtPath: true, txtTokens: true },
  });
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  // Idempotent fast path
  if (book.txtTokens !== null && book.txtTokens !== undefined) {
    return NextResponse.json({ txtTokens: book.txtTokens, cached: true });
  }

  if (!book.txtPath) {
    return NextResponse.json(
      { error: "Book has no plaintext path" },
      { status: 400 }
    );
  }

  try {
    const text = (await storage.read(book.txtPath)).toString("utf-8");
    const txtTokens = countTokens(text);
    await db.epubFile.update({
      where: { id },
      data: { txtTokens },
    });
    return NextResponse.json({ txtTokens, cached: false });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to tokenize book" },
      { status: 500 }
    );
  }
}
