import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { reorderUpcoming } from "@/server/services/playlist";

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

    const ids = Array.isArray(body.orderedIds)
      ? body.orderedIds
      : null;
    if (
      !ids ||
      ids.some((id: unknown) => typeof id !== "string")
    ) {
      return NextResponse.json(
        { error: "orderedIds must be an array of strings" },
        { status: 400 },
      );
    }

    await reorderUpcoming(user.id, ids as string[]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    if (
      error.message === "No active playlist item" ||
      error.message === "Invalid upcoming item order"
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }
    console.error("[POST /api/playlist/reorder]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
