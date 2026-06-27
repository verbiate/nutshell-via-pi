import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import {
  getPromptTemplates,
  updatePromptTemplate,
  getBookTwoPassEnabled,
  updateBookTwoPassEnabled,
  getAttachBookMaxSettings,
  updateAttachBookMaxSettings,
} from "@/server/services/admin";

export async function GET() {
  try {
    await requireAdmin();
    const [templates, twoPassEnabled, attachBookMax] = await Promise.all([
      getPromptTemplates(),
      getBookTwoPassEnabled(),
      getAttachBookMaxSettings(),
    ]);
    return NextResponse.json({ templates, twoPassEnabled, attachBookMax });
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
    const { type, content, twoPassEnabled, attachBookMax } = body as {
      type?: string;
      content?: string;
      twoPassEnabled?: boolean;
      attachBookMax?: Partial<Record<"regular" | "pro" | "admin", number>>;
    };

    // ponytail: one route handles template edits, the two-pass toggle, and the
    // per-tier attach-book cap. Each arm is optional; at least one must be present.
    const hasTemplateUpdate = Boolean(type && content);
    const hasToggleUpdate = typeof twoPassEnabled === "boolean";
    const hasAttachBookUpdate =
      !!attachBookMax &&
      Object.values(attachBookMax).some(
        (v) => typeof v === "number" && Number.isFinite(v)
      );
    if (!hasTemplateUpdate && !hasToggleUpdate && !hasAttachBookUpdate) {
      return NextResponse.json(
        { error: "Provide {type, content} and/or {twoPassEnabled} and/or {attachBookMax}" },
        { status: 400 }
      );
    }

    if (hasTemplateUpdate) {
      await updatePromptTemplate(admin.id, type as string, content as string);
    }
    if (hasToggleUpdate) {
      await updateBookTwoPassEnabled(admin.id, twoPassEnabled as boolean);
    }
    if (hasAttachBookUpdate) {
      await updateAttachBookMaxSettings(admin.id, attachBookMax!);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
