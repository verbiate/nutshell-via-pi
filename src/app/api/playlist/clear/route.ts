import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { clearPlaylist } from "@/server/services/playlist";

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

    const scope = body.scope === "all" || body.scope === "upcoming" ? body.scope : null;
    if (!scope) {
      return NextResponse.json(
        { error: "scope must be 'all' or 'upcoming'" },
        { status: 400 },
      );
    }

    await clearPlaylist(user.id, scope);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    console.error("[POST /api/playlist/clear]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
