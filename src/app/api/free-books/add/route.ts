import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-guards";
import { processAndUploadBook } from "@/server/services/epub-processor";

const FREE_BOOKS_DIR = path.join(process.cwd(), "public/free-books");

// Add a public-domain EPUB from public/free-books/ to the current user's
// personal library. Reuses processAndUploadBook so dedup/cover/text/token logic
// is identical to the upload path — no parallel business logic.
export async function POST(request: Request) {
  try {
    const user = await requireAuth();

    const { filename } = await request.json();
    if (
      typeof filename !== "string" ||
      !filename.toLowerCase().endsWith(".epub") ||
      filename.includes("/") ||
      filename.includes("..")
    ) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const filePath = path.join(FREE_BOOKS_DIR, filename);
    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }

    const file = new File([new Uint8Array(buffer)], filename, {
      type: "application/epub+zip",
    });

    const result = await processAndUploadBook(file, user.id, user.role);

    return NextResponse.json({
      bookId: result.book.id,
      added: !result.isNew,
    });
  } catch (error: any) {
    if (error instanceof AuthError || error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    console.error("free-books/add error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to add book" },
      { status: 500 },
    );
  }
}
