import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import {
  updatePromptPreset,
  deletePromptPreset,
} from "@/server/services/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      content?: string;
    };

    if (body.name === undefined && body.content === undefined) {
      return NextResponse.json(
        { error: "Provide {name} and/or {content}" },
        { status: 400 }
      );
    }

    await updatePromptPreset(admin.id, id, {
      name: body.name,
      content: body.content,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    // ponytail: P2002 = renamed onto an existing (type, name).
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "A preset with that name already exists for this level" },
        { status: 409 }
      );
    }
    if (error.message === "Preset not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    await deletePromptPreset(admin.id, id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    if (error.message === "Preset not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
