import { storage } from "@/server/storage/local";
import { NextRequest, NextResponse } from "next/server";

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
    const { path } = await params;

    if (!path || path.length === 0 || path.some((p) => !p)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const relativePath = path.join("/");
    const buffer = await storage.read(relativePath);

    const contentType = getContentType(relativePath);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("ENOENT") || errorMessage.includes("no such file")) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    console.error("[/api/files] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
