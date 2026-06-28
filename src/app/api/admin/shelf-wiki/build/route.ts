import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting } from "@/server/services/settings";
import { build } from "@/server/services/shelf-knowledge/build-wiki";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/shelf-wiki/build
 *
 * Kicks off the shelf-wiki build fire-and-forget. The build takes ~30s+ and
 * writes progress/terminal status to AppSetting.shelfWikiStatus itself, so we
 * respond immediately with the current status and let the UI poll GET /status.
 * 409 if a build is already in progress. Admin-only.
 */
export async function POST() {
  try {
    await requireAdmin();

    // ponytail: race-window guard. build() sets "building" itself, but we check
    // here too so a second click gets a clean 409 instead of a duplicate run.
    // Tiny TOCTOU window between read and build() — acceptable for admin-only.
    const raw = await getSetting("shelfWikiStatus");
    const current = raw ? JSON.parse(raw) : { state: "idle" };
    if (current.state === "building") {
      return NextResponse.json(
        { error: "already building", status: current },
        { status: 409 },
      );
    }

    // Fire-and-forget; build() sets "building" immediately, then "done"/"error".
    void build().catch((err) => {
      console.error("[shelf-wiki] background build failed:", err);
    });

    return NextResponse.json(
      { state: "building", at: new Date().toISOString() },
      { status: 202 },
    );
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
