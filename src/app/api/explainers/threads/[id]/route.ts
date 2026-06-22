export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { getThreadWithMessages } from "@/server/services/explainer-threads";

/**
 * GET /api/explainers/threads/[id]
 *
 * Returns a thread with its initial explainer content + all follow-up
 * messages. Ownership-checked (only the thread's owner can read it).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const thread = await getThreadWithMessages(id, user.id);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    return NextResponse.json({ thread });
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
