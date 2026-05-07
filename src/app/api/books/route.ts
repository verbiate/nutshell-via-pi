import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { getPersonalLibrary } from "@/server/services/library";

export async function GET() {
  try {
    const user = await requireAuth();
    const books = await getPersonalLibrary(user.id);

    return NextResponse.json({
      books: books.map((ba) => ({
        id: ba.book.id,
        title: ba.book.title,
        author: ba.book.author,
        language: ba.book.language,
        coverPath: ba.book.coverPath,
        fileSize: ba.book.fileSize,
        createdAt: ba.book.createdAt,
        accessGrantedAt: ba.createdAt,
      })),
    });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load library" }, { status: 500 });
  }
}
