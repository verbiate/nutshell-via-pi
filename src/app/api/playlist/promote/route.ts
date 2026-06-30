import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { promoteItem } from "@/server/services/playlist";
import { verifyBookAccess } from "@/server/services/reader";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const bookId = typeof body.bookId === "string" ? body.bookId : "";
    const sectionHref =
      typeof body.sectionHref === "string" ? body.sectionHref : "";
    const sectionLabel =
      typeof body.sectionLabel === "string" ? body.sectionLabel : "";

    if (!bookId || !sectionHref || !sectionLabel) {
      return NextResponse.json(
        { error: "bookId, sectionHref, and sectionLabel are required" },
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

    const item = await promoteItem(user.id, {
      bookId,
      sectionHref,
      sectionLabel,
      bookTitle: typeof body.bookTitle === "string" ? body.bookTitle : undefined,
      bookAuthor: typeof body.bookAuthor === "string" ? body.bookAuthor : null,
      bookCoverPath:
        typeof body.bookCoverPath === "string" ? body.bookCoverPath : undefined,
      bookLanguage:
        typeof body.bookLanguage === "string" ? body.bookLanguage : undefined,
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    console.error("[POST /api/playlist/promote]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
