import { storage } from "@/server/storage/local";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { db } from "@/server/db";
import { verifyBookAccess } from "@/server/services/reader";

const CONTENT_TYPES: Record<string, string> = {
  ".epub": "application/epub+zip",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function getContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[`.${ext}`] ?? "application/octet-stream";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  try {
    const user = await requireAuth();
    const { path } = await params;

    if (!path || path.length === 0 || path.some((p) => !p)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    // ponytail: reject path traversal before storage.read — storage.resolveFilePath
    // uses path.join, so normalized '..' segments can escape STORAGE_ROOT.
    if (path.some((p) => p === ".." || p.includes("/") || p.includes("\\"))) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const relativePath = path.join("/");

    // Per-resource access for book-keyed files. TTS audio lives under tts/{hash}/
    // and is universal-cache by content hash (not enumerable); auth-only is sufficient.
    const segments = relativePath.split("/");
    const prefix = segments[0];
    if (prefix === "epubs" || prefix === "txts" || prefix === "covers") {
      const md5 = segments[1]?.split(".")[0];
      if (!md5) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const book = await db.epubFile.findUnique({
        where: { md5 },
        select: { id: true },
      });
      if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const ok = await verifyBookAccess(user.id, book.id);
      if (!ok) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    // ponytail: tts/{hash}/ skips access check — SHA-256 hashes are unguessable,
    // and the design caches them globally. Add per-book check if hashes leak into URLs.

    const buffer = await storage.read(relativePath);
    const contentType = getContentType(relativePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ENOENT") || msg.includes("no such file"))
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    console.error("[/api/files] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
