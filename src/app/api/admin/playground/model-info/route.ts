export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getContextWindow } from "@/server/services/model-info";

/**
 * GET /api/admin/playground/model-info?model=<slug>
 *
 * Thin wrapper over the shared model-info service. Used by the admin
 * playground's context-window indicator. The same cache backs the upload
 * pipeline's tier-token-limit resolution.
 */
export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const model = searchParams.get("model");
  if (!model) {
    return NextResponse.json(
      { error: "model query param is required" },
      { status: 400 }
    );
  }

  const { contextLength, source } = await getContextWindow(model);
  return NextResponse.json({ contextLength, source });
}
