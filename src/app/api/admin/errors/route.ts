export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { listErrors, resolveError, countUnresolved } from "@/server/services/errors";

/**
 * GET /api/admin/errors
 *
 * Query params: ?resolved=true|false&category=<cat>&limit=<n>&cursor=<iso>
 *
 * Returns admin-visible errors. Newest first. Keyset pagination via cursor
 * (createdAt of last item).
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const resolvedParam = searchParams.get("resolved");
  const resolved =
    resolvedParam === "true" ? true :
    resolvedParam === "false" ? false :
    undefined;

  const result = await listErrors({
    resolved,
    category: searchParams.get("category") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    cursor: searchParams.get("cursor") ?? undefined,
  });
  const unresolvedCount = await countUnresolved();
  return NextResponse.json({ ...result, unresolvedCount });
}

/**
 * PATCH /api/admin/errors
 *
 * Body: { id: string, resolved: boolean }
 *
 * Currently only flips `resolved` to true. Extensible.
 */
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const { id, resolved } = body as { id?: string; resolved?: boolean };

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (resolved !== true) {
      return NextResponse.json({ error: "Only resolved=true is supported" }, { status: 400 });
    }

    await resolveError(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error.statusCode === 403)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
