import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { deleteBookmark } from "@/server/services/reader";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    await deleteBookmark(user.id, id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (error.message === "Bookmark not found or access denied") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[DELETE /api/reader/bookmarks/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
