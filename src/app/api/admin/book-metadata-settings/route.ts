export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting, setSetting } from "@/server/services/settings";
import { db } from "@/server/db";
import { getOpenRouterConfig } from "@/server/services/openrouter";

const SETTING_KEY = "bookMetadataModel";

/**
 * GET /api/admin/book-metadata-settings
 *
 * Returns { model, fallback }. `model` is the saved override (or null when
 * unset); `fallback` is the admin-tier model from the API Keys & Models page,
 * surfaced so the UI can show what will be used when model is null.
 */
export async function GET() {
  try {
    await requireAdmin();
    const [model, { model: fallback }] = await Promise.all([
      getSetting(SETTING_KEY),
      getOpenRouterConfig("admin"),
    ]);
    return NextResponse.json({ model, fallback });
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
 * PATCH /api/admin/book-metadata-settings
 *
 * Body: { model: string | null }
 *
 * Upserts the model override. Empty string or null clears the override so the
 * service falls back to the admin-tier model. Audit-logged.
 */
export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const { model } = body as { model?: string | null };

    if (model !== null && typeof model !== "string") {
      return NextResponse.json(
        { error: "model must be a string or null" },
        { status: 400 }
      );
    }

    const trimmed = typeof model === "string" ? model.trim() : null;
    const normalized = trimmed === "" ? null : trimmed;

    const oldValue = await getSetting(SETTING_KEY);
    await setSetting(SETTING_KEY, normalized);

    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: "BOOK_METADATA_MODEL_UPDATED",
        entityType: "AppSetting",
        entityId: SETTING_KEY,
        oldValue: oldValue ?? null,
        newValue: normalized ?? null,
      },
    });

    return NextResponse.json({ success: true, model: normalized });
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
