import { readFile, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

const FREE_BOOKS_DIR = path.join(process.cwd(), "public/free-books");

// ponytail: module-level cover cache keyed by filename. Stores the extracted
// image buffer + mtime so an unchanged file is served from memory. Lost on
// server restart — fine for dev/self-host; browser Cache-Control covers repeat
// visits in the meantime.
interface CoverCacheEntry {
  mtime: number;
  data: Uint8Array;
  mediaType: string;
}
const coverCache = new Map<string, CoverCacheEntry>();

function getAttr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"', "i"));
  return m ? m[1] : null;
}

async function extractCover(
  filePath: string,
): Promise<{ data: Uint8Array; mediaType: string } | null> {
  const buffer = await readFile(filePath);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  if (!containerXml) return null;

  const opfPath = containerXml.match(/full-path="([^"]+\.opf)"/i)?.[1];
  if (!opfPath) return null;

  const opf = await zip.file(opfPath)?.async("text");
  if (!opf) return null;

  const rootDir = opfPath.includes("/")
    ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1)
    : "";

  const itemTags = opf.match(/<item\b[^>]*>/gi) || [];

  // EPUB 3: properties="cover-image"
  let coverTag: string | null = itemTags.find((t) =>
    /\bcover-image\b/.test(getAttr(t, "properties") || ""),
  ) || null;

  // EPUB 2: <meta name="cover" content="id" />
  if (!coverTag) {
    const coverMeta = (opf.match(/<meta\b[^>]*>/gi) || []).find(
      (t) => getAttr(t, "name") === "cover",
    );
    const coverId = coverMeta ? getAttr(coverMeta, "content") : null;
    if (coverId) {
      coverTag = itemTags.find((t) => getAttr(t, "id") === coverId) || null;
    }
  }

  const href = coverTag ? getAttr(coverTag, "href") : null;
  if (!coverTag || !href) return null;

  const mediaType = getAttr(coverTag, "media-type") || "image/jpeg";
  const coverData = await zip.file(rootDir + href)?.async("uint8array");
  if (!coverData) return null;

  return { data: coverData, mediaType };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;

  // ponytail: prevent path traversal — only bare filenames allowed.
  if (!filename || filename.includes("/") || filename.includes("..")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const filePath = path.join(FREE_BOOKS_DIR, filename);
  if (!filePath.toLowerCase().endsWith(".epub")) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const st = await stat(filePath);
    const mtime = st.mtimeMs;

    let entry = coverCache.get(filename);
    if (!entry || entry.mtime !== mtime) {
      const result = await extractCover(filePath);
      if (!result) return new NextResponse("No cover", { status: 404 });
      entry = { mtime, data: result.data, mediaType: result.mediaType };
      coverCache.set(filename, entry);
    }

    return new NextResponse(entry.data as BodyInit, {
      headers: {
        "Content-Type": entry.mediaType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
