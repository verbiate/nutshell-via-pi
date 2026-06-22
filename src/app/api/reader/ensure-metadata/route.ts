export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { extractBookMetadata } from "@/server/services/book-metadata";

/**
 * POST /api/reader/ensure-metadata
 *
 * Body: { bookId: string }
 *
 * Idempotent: if a BookMetadata row already exists for this book, returns it
 * without calling the LLM. Otherwise runs extraction using the admin-tier
 * model + the `book_metadata` prompt template. Used as the reader-side
 * fallback for stray books (uploaded before auto-extract) and for
 * just-uploaded books whose background extraction hasn't completed yet.
 *
 * Auth: any logged-in user with access to this book. The actor is recorded
 * in the audit log.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();

    let body: { bookId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { bookId } = body;
    if (!bookId) {
      return NextResponse.json({ error: "bookId is required" }, { status: 400 });
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const metadata = await extractBookMetadata(bookId, user.id);
    return NextResponse.json({ metadata });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    // ponytail: surface the LLM/parse error so the client can stop spinning
    // and the user (often an admin testing) gets a clue. Non-admins will just
    // see no description; failures also land in the Errors admin page.
    return NextResponse.json(
      { error: error.message || "Failed to extract metadata" },
      { status: error.statusCode ?? 500 }
    );
  }
}
