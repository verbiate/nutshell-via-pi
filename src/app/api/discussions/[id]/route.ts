export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import {
  deleteDiscussion,
  getAttachBookMax,
  getDiscussionWithMessages,
} from "@/server/services/discussions";

/**
 * GET /api/discussions/[id]
 *
 * Returns a discussion with its initial explainer content + all follow-up
 * messages. Ownership-checked (only the discussion's owner can read it).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const discussion = await getDiscussionWithMessages(id, user.id);
    if (!discussion) {
      return NextResponse.json({ error: "Discussion not found" }, { status: 404 });
    }

    // ponytail: per-tier "attach another book" cap so the homepage composer
    // (which has no /api/books/[id] fetch) can gate the Other-book picker
    // without a second round-trip. Reader gets this from its book-detail call.
    const attachBookMax = await getAttachBookMax(user.role);

    return NextResponse.json({ discussion, attachBookMax });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    if (error.statusCode === 403)
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/discussions/[id]
 *
 * Deletes the discussion and its follow-up messages for the requesting user.
 * The shared Explainer cache row is NOT deleted. Ownership-checked.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    await deleteDiscussion(user.id, id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    if (error.statusCode === 403)
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    if (error.message === "Discussion not found or access denied")
      return NextResponse.json({ error: error.message }, { status: 404 });
    console.error("[DELETE /api/discussions/[id]]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
