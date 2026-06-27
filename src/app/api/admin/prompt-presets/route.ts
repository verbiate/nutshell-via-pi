import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import {
  getPromptPresets,
  createPromptPreset,
} from "@/server/services/admin";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? undefined;
    const presets = await getPromptPresets(type ?? undefined);
    return NextResponse.json({ presets });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as {
      type?: string;
      name?: string;
      content?: string;
    };

    if (!body.type || !body.name || typeof body.content !== "string") {
      return NextResponse.json(
        { error: "Provide {type, name, content}" },
        { status: 400 }
      );
    }

    const preset = await createPromptPreset(admin.id, {
      type: body.type,
      name: body.name,
      content: body.content,
    });
    return NextResponse.json(preset, { status: 201 });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    // ponytail: Prisma P2002 = unique-constraint hit → dup (type, name). Map to 409.
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "A preset with that name already exists for this level" },
        { status: 409 }
      );
    }
    if (error.message === "Invalid preset type") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
