import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { deleteNote, updateNote } from "@/server/services/reader";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    let body: { body?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const trimmed = body.body?.trim();
    if (trimmed === undefined) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }
    if (!trimmed) {
      return NextResponse.json({ error: "body must not be empty" }, { status: 400 });
    }

    const note = await updateNote(user.id, id, { body: trimmed });
    return NextResponse.json({ note });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (error.message === "Note not found or access denied") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[PATCH /api/reader/notes/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    await deleteNote(user.id, id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (error.message === "Note not found or access denied") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[DELETE /api/reader/notes/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
