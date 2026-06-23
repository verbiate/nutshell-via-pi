export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { purgeExplainerCache } from "@/server/services/admin";

/**
 * DELETE /api/explainers/[id]
 *
 * Admin-only: deletes the globally-shared Explainer cache row. This cascades
 * to every user's threads + messages for this passage. The next request for
 * the same passage will regenerate the cache.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAdmin();
    const { id } = await params;

    await purgeExplainerCache(user.id, id);
    return NextResponse.json({ success: true });
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
    if (error.message === "Explainer not found")
      return NextResponse.json({ error: error.message }, { status: 404 });
    console.error("[DELETE /api/explainers/[id]]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
