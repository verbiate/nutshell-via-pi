import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { getBookForUser } from "@/server/services/library";
import { getOpenRouterConfig } from "@/server/services/openrouter";
import { getContextWindow } from "@/server/services/model-info";

// ponytail: client-side book detail for the persistent ReaderMount. Returns
// everything ReaderClient needs (book row + metadata + token-budget context
// window + role) so the reader can stay mounted across book-to-book swaps
// without a server remount.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const [{ model }, book] = await Promise.all([
      getOpenRouterConfig(session.role),
      getBookForUser(id, session.id),
    ]);

    if (!book) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }

    const { contextLength: contextWindow } = await getContextWindow(model);

    return NextResponse.json({
      book: {
        id: book.id,
        title: book.title,
        author: book.author,
        coverPath: book.coverPath,
        language: book.language,
        epubPath: book.epubPath,
        createdAt: book.createdAt.toISOString(),
        txtTokens: book.txtTokens,
        bookMetadata: book.bookMetadata
          ? {
              title: book.bookMetadata.title,
              subtitle: book.bookMetadata.subtitle,
              description: book.bookMetadata.description,
              isNarrative: book.bookMetadata.isNarrative,
            }
          : null,
      },
      contextWindow,
      isAdmin: session.role === "admin",
      userName: session.name,
    });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: "Failed to load book" }, { status: 500 });
  }
}
