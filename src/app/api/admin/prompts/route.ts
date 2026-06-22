import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import {
  getPromptTemplates,
  updatePromptTemplate,
  getBookTwoPassEnabled,
  updateBookTwoPassEnabled,
} from "@/server/services/admin";

export async function GET() {
  try {
    await requireAdmin();
    const [templates, twoPassEnabled] = await Promise.all([
      getPromptTemplates(),
      getBookTwoPassEnabled(),
    ]);
    return NextResponse.json({ templates, twoPassEnabled });
  } catch (error: any) {
    if (error.statusCode === 401) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const { type, content, twoPassEnabled } = body as {
      type?: string;
      content?: string;
      twoPassEnabled?: boolean;
    };

    // ponytail: one route handles both template edits and the toggle. Either
    // arm is optional, but at least one must be present.
    const hasTemplateUpdate = Boolean(type && content);
    const hasToggleUpdate = typeof twoPassEnabled === "boolean";
    if (!hasTemplateUpdate && !hasToggleUpdate) {
      return NextResponse.json(
        { error: "Provide {type, content} and/or {twoPassEnabled}" },
        { status: 400 }
      );
    }

    if (hasTemplateUpdate) {
      await updatePromptTemplate(admin.id, type as string, content as string);
    }
    if (hasToggleUpdate) {
      await updateBookTwoPassEnabled(admin.id, twoPassEnabled as boolean);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
