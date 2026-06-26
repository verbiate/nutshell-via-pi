import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { getPlaylist, getAutoAdvance } from "@/server/services/playlist";

export async function GET() {
  try {
    const user = await requireAuth();
    const [items, autoAdvanceBook] = await Promise.all([
      getPlaylist(user.id),
      getAutoAdvance(user.id),
    ]);
    return NextResponse.json({ items, autoAdvanceBook });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    console.error("[GET /api/playlist]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
