import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { getCurrentUsage } from "@/server/services/tts-usage";

/**
 * POST /api/tts/usage-check
 *
 * Returns the caller's current monthly TTS quota snapshot. Read-only — the
 * increment happens in /api/tts/generate after a successful generation.
 * Kept as POST (empty body) to match the existing API shape and avoid
 * accidental GET-preflight caching of per-user data.
 */
export async function POST() {
  try {
    const user = await requireAuth();
    const snapshot = await getCurrentUsage(user.id, user.role);
    const { used, limit, periodKey } = snapshot;
    return NextResponse.json({ allowed: used < limit, used, limit, periodKey });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[POST /api/tts/usage-check]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
