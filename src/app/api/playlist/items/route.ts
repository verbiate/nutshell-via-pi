import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { addItem } from "@/server/services/playlist";
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
    const sectionHref = typeof body.sectionHref === "string" ? body.sectionHref : "";
    const sectionLabel = typeof body.sectionLabel === "string" ? body.sectionLabel : "";
    const mode = body.mode === "next" || body.mode === "last" ? body.mode : null;
    const text = typeof body.text === "string" ? body.text : "";
    const kind = body.kind === "text" || body.kind === "section" ? body.kind : null;

    if (!mode || !sectionLabel) {
      return NextResponse.json(
        { error: "sectionLabel and mode ('next'|'last') are required" },
        { status: 400 },
      );
    }

    // Text tracks (discussion replies, etc.) carry no book reference.
    const isTextTrack = kind === "text" || (!kind && !bookId && !sectionHref && !!text);
    if (isTextTrack) {
      if (!text) {
        return NextResponse.json(
          { error: "text is required for text tracks" },
          { status: 400 },
        );
      }
    } else {
      // Section track — must reference an accessible book.
      if (!bookId || !sectionHref) {
        return NextResponse.json(
          { error: "bookId and sectionHref are required for section tracks" },
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
    }

    const item = await addItem(user.id, {
      sectionLabel,
      mode,
      kind: isTextTrack ? "text" : undefined,
      bookId: bookId || undefined,
      sectionHref: sectionHref || undefined,
      text: isTextTrack ? text : undefined,
      bookTitle: typeof body.bookTitle === "string" ? body.bookTitle : undefined,
      bookAuthor: typeof body.bookAuthor === "string" ? body.bookAuthor : null,
      bookCoverPath: typeof body.bookCoverPath === "string" ? body.bookCoverPath : undefined,
      bookLanguage: typeof body.bookLanguage === "string" ? body.bookLanguage : undefined,
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    console.error("[POST /api/playlist/items]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
