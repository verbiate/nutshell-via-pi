import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { db } from "@/server/db";
import { hrefBasename } from "@/lib/explainer/citations";

// ponytail: batched spine-href resolver for shelf-discussion #ch:<bookId>:
// <basename> deep links. Access-checks every bookId (no structure leak to
// non-readers); returns basenames parsed from each accessible book's tocJson,
// mirroring the attachedBookHrefs shape ExplainerContent validates against.
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json().catch(() => null);
    const rawIds: unknown = body?.bookIds;
    const bookIds = Array.isArray(rawIds)
      ? Array.from(
          new Set(
            rawIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
          )
        )
      : [];
    if (bookIds.length === 0) return NextResponse.json({});

    const accessible: string[] = [];
    for (const id of bookIds) {
      if (await verifyBookAccess(user.id, id)) accessible.push(id);
    }
    if (accessible.length === 0) return NextResponse.json({});

    const rows = await db.epubFile.findMany({
      where: { id: { in: accessible } },
      select: { id: true, tocJson: true },
    });
    const out: Record<string, string[]> = {};
    for (const r of rows) {
      try {
        const toc = JSON.parse(r.tocJson ?? "[]") as Array<{ href?: string }>;
        const hrefs = toc
          .map((t) => hrefBasename(t.href ?? ""))
          .filter((h) => h.length > 0);
        if (hrefs.length > 0) out[r.id] = hrefs;
      } catch {
        /* skip unparseable tocJson */
      }
    }
    return NextResponse.json(out);
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load hrefs" }, { status: 500 });
  }
}
