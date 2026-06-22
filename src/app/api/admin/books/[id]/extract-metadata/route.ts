export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { extractBookMetadata } from "@/server/services/book-metadata";

/**
 * POST /api/admin/books/[id]/extract-metadata
 *
 * Runs the LLM book-metadata extraction prompt against the book's full
 * plaintext, upserts the result onto BookMetadata, and returns the parsed
 * fields. Re-runs overwrite the existing row. Admin-only.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;

  try {
    // ponytail: force=true bypasses the existing-row short-circuit in
    // extractBookMetadata. Admin's "Re-extract" button always runs a fresh
    // LLM call and overwrites the row; reader-side ensure-metadata (default)
    // is idempotent.
    const metadata = await extractBookMetadata(id, admin.id, { force: true });
    return NextResponse.json({ metadata });
  } catch (error: any) {
    const status = error.statusCode ?? 500;
    if (status === 404)
      return NextResponse.json({ error: error.message }, { status: 404 });
    if (status === 400)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
