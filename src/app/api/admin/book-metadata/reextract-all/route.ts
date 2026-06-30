export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import {
  getReextractAllStatus,
  reextractAllBookMetadata,
} from "@/server/services/book-metadata";

/**
 * POST /api/admin/book-metadata/reextract-all
 *   Kicks off a fire-and-forget batch re-extraction of metadata for every
 *   book in the Universal Library. Status is polled via GET below. 409 if a
 *   batch is already running. Admin-only.
 *
 * GET /api/admin/book-metadata/reextract-all
 *   Returns { state, at, total?, done?, current?, error? } from the
 *   AppSetting stash so the UI can render progress.
 */
export async function POST() {
  let admin;
  try {
    admin = await requireAdmin();
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

  const status = await getReextractAllStatus();
  if (status.state === "running") {
    return NextResponse.json(
      { error: "already running", status },
      { status: 409 }
    );
  }

  // Fire-and-forget; service writes status to AppSetting.
  void reextractAllBookMetadata(admin.id).catch((err) => {
    console.error("[book-metadata] background reextract-all failed:", err);
  });

  return NextResponse.json(
    { state: "running", at: new Date().toISOString() },
    { status: 202 }
  );
}

export async function GET() {
  try {
    await requireAdmin();
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
  const status = await getReextractAllStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-cache, no-transform" },
  });
}
