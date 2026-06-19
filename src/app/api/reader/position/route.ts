import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth-guards";
import { getPosition, savePosition, verifyBookAccess } from "@/server/services/reader";

/**
 * GET /api/reader/position?bookId=xxx
 *
 * Fetch the saved reading position for the authenticated user and book.
 * Returns { position: { paragraphIndex, charOffset, cfi, tocSectionId } | null }
 *
 * Returns 403 if the user does not have access to the book.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get("bookId");

    if (!bookId) {
      return NextResponse.json({ error: "bookId is required" }, { status: 400 });
    }

    // Validate book access before returning position
    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "You do not have access to this book" },
        { status: 403 }
      );
    }

    const position = await getPosition(user.id, bookId);

    return NextResponse.json({
      position: position ?? null,
    });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[GET /api/reader/position]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/reader/position
 *
 * Save the current reading position for the authenticated user and book.
 * Body: { bookId, paragraphIndex, charOffset, cfi?, tocSectionId? }
 *
 * Returns 403 if the user does not have access to the book.
 * Returns 400 if required fields are missing or invalid.
 */
export async function POST(request: Request) {
  try {
    // DEBUG: log raw incoming request before any processing
    const rawBody = await request.text();
    console.log("[POSITION POST] raw body:", rawBody);

    const user = await requireAuth();
    console.log("[POSITION POST] auth ok, user:", user.id);

    let body: {
      bookId?: string;
      paragraphIndex?: number;
      charOffset?: number;
      cfi?: string;
      tocSectionId?: string;
      percentage?: number;
    };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { bookId, paragraphIndex, charOffset, cfi, tocSectionId, percentage } = body;

    // Validate required fields
    if (!bookId || typeof bookId !== "string" || bookId.trim() === "") {
      return NextResponse.json(
        { error: "bookId is required and must be a non-empty string" },
        { status: 400 }
      );
    }
    if (
      paragraphIndex === undefined ||
      typeof paragraphIndex !== "number" ||
      paragraphIndex < 0 ||
      !Number.isInteger(paragraphIndex)
    ) {
      return NextResponse.json(
        { error: "paragraphIndex is required and must be a non-negative integer" },
        { status: 400 }
      );
    }
    if (
      charOffset === undefined ||
      typeof charOffset !== "number" ||
      charOffset < 0 ||
      !Number.isInteger(charOffset)
    ) {
      return NextResponse.json(
        { error: "charOffset is required and must be a non-negative integer" },
        { status: 400 }
      );
    }
    if (
      percentage !== undefined &&
      (typeof percentage !== "number" ||
        percentage < 0 ||
        percentage > 100 ||
        !Number.isInteger(percentage))
    ) {
      return NextResponse.json(
        { error: "percentage must be an integer between 0 and 100" },
        { status: 400 }
      );
    }

    // Validate book access before saving
    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "You do not have access to this book" },
        { status: 403 }
      );
    }

    console.log("[POSITION POST] validated, calling savePosition:", {
      bookId, paragraphIndex, charOffset, percentage, cfi: cfi?.slice(0, 30) });
    await savePosition(user.id, bookId, {
      paragraphIndex,
      charOffset,
      cfi,
      tocSectionId,
      percentage,
    });
    console.log("[POSITION POST] savePosition returned ok");

    // Bust the cached /my-library so the bookshelf reflects the new recency /
    // progress on the next visit — covers browser-back and other return paths
    // that don't go through the reader's in-app Back button (which router.refresh()s).
    revalidatePath("/my-library");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[POST /api/reader/position]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
