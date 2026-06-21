export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting, setSetting } from "@/server/services/settings";

const SETTING_KEY = "globalSystemPrompt";

/**
 * GET /api/admin/system-prompt
 *
 * Returns the saved global system prompt (or null if never set).
 * Admin-only.
 */
export async function GET() {
  try {
    await requireAdmin();
    const prompt = await getSetting(SETTING_KEY);
    return NextResponse.json({ prompt });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    if (error.statusCode === 403)
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/system-prompt
 *
 * Body: { prompt: string | null }
 *
 * Upserts the global system prompt and writes an AuditLog entry.
 * Admin-only.
 */
export async function PUT(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const { prompt } = body as { prompt?: string | null };

    if (prompt !== null && typeof prompt !== "string") {
      return NextResponse.json(
        { error: "prompt must be a string or null" },
        { status: 400 }
      );
    }

    const oldValue = await getSetting(SETTING_KEY);
    await setSetting(SETTING_KEY, prompt ?? null);

    const { db } = await import("@/server/db");
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE_GLOBAL_SYSTEM_PROMPT",
        entityType: "AppSetting",
        entityId: SETTING_KEY,
        oldValue: oldValue ?? null,
        newValue: prompt ?? null,
      },
    });

    return NextResponse.json({ success: true, prompt });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    if (error.statusCode === 403)
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
