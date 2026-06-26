import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { activateItem, removeItem } from "@/server/services/playlist";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (body.action !== "activate") {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 },
      );
    }

    const item = await activateItem(user.id, id);
    return NextResponse.json({ item });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    if (error.message === "Playlist item not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[PATCH /api/playlist/items/[id]]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await removeItem(user.id, id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    if (error.message === "Playlist item not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[DELETE /api/playlist/items/[id]]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
