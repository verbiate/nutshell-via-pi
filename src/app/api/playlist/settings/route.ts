import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { getAutoAdvance, setAutoAdvance } from "@/server/services/playlist";

export async function GET() {
  try {
    const user = await requireAuth();
    const autoAdvanceBook = await getAutoAdvance(user.id);
    return NextResponse.json({ autoAdvanceBook });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    console.error("[GET /api/playlist/settings]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
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

    if (typeof body.autoAdvanceBook !== "boolean") {
      return NextResponse.json(
        { error: "autoAdvanceBook boolean required" },
        { status: 400 },
      );
    }

    await setAutoAdvance(user.id, body.autoAdvanceBook);
    return NextResponse.json({ autoAdvanceBook: body.autoAdvanceBook });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    console.error("[PATCH /api/playlist/settings]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
