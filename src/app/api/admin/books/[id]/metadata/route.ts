export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import {
  getBookMetadataView,
  revertBookMetadataField,
  type RevertableField,
} from "@/server/services/book-metadata";

/**
 * GET /api/admin/books/[id]/metadata
 *   Returns { epub: {title, author, language}, metadata: BookMetadata | null }.
 *
 * PATCH /api/admin/books/[id]/metadata
 *   Body: { field: "title" | "author" | "language" }
 *   Copies the OPF-original value from EpubFile back into BookMetadata for
 *   that single field. Audit-logged.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const view = await getBookMetadataView(id);
  if (!view)
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  // ponytail: no-cache so the browser always revalidates — without this,
  // TanStack Query's post-mutation invalidate triggers a refetch that the
  // browser serves from HTTP heuristic cache, so the UI never visibly
  // updates (extractedAt/promptVersion move server-side but not in DOM).
  return NextResponse.json(view, {
    headers: { "Cache-Control": "no-cache, no-transform" },
  });
}

const ALLOWED_FIELDS: ReadonlySet<RevertableField> = new Set([
  "title",
  "author",
  "language",
]);

export async function PATCH(
  request: Request,
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

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const field = body?.field;
  if (!ALLOWED_FIELDS.has(field)) {
    return NextResponse.json(
      { error: "Invalid or missing 'field'. Must be one of: title, author, language." },
      { status: 400 }
    );
  }

  try {
    await revertBookMetadataField(id, field as RevertableField, admin.id);
    const view = await getBookMetadataView(id);
    return NextResponse.json(view);
  } catch (error: any) {
    const status = error.statusCode ?? 500;
    if (status === 404 || status === 400)
      return NextResponse.json({ error: error.message }, { status });
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
