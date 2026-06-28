import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting } from "@/server/services/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/shelf-wiki/status
 *
 * Returns the current shelf-wiki build status from AppSetting.shelfWikiStatus
 * (JSON: { state, at, counts?, message? }) or { state: "idle" } when unset.
 * Admin-only.
 */
export async function GET() {
  try {
    await requireAdmin();
    const raw = await getSetting("shelfWikiStatus");
    const status = raw ? JSON.parse(raw) : { state: "idle" };
    return NextResponse.json(status);
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
