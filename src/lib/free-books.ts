import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import type { FreeBook } from "@/types/free-book";

const FREE_BOOKS_DIR = path.join(process.cwd(), "public/free-books");
const FREE_BOOKS_URL = "/free-books";

// ponytail: module-level metadata cache keyed by filename. Each entry stores
// the file's mtime so a changed file is re-parsed but unchanged files are free.
// Lost on server restart — fine for dev/self-host; add disk cache if needed.
interface CacheEntry {
  mtime: number;
  title: string;
  author: string | null;
}
const metaCache = new Map<string, CacheEntry>();

/**
 * Read title + author from an EPUB's OPF metadata. Lightweight: only opens
 * the zip enough to read container.xml + the OPF — no spine/text/cover work.
 * Falls back to the bare filename if anything goes wrong.
 */
async function extractEpubMeta(
  filePath: string,
  fallbackTitle: string,
): Promise<{ title: string; author: string | null }> {
  try {
    const buffer = await readFile(filePath);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);

    const containerXml = await zip.file("META-INF/container.xml")?.async("text");
    if (!containerXml) return { title: fallbackTitle, author: null };

    const opfPath = containerXml.match(/full-path="([^"]+\.opf)"/i)?.[1];
    if (!opfPath) return { title: fallbackTitle, author: null };

    const opf = await zip.file(opfPath)?.async("text");
    if (!opf) return { title: fallbackTitle, author: null };

    const title =
      opf.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i)?.[1]?.trim() ||
      fallbackTitle;
    const author =
      opf.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i)?.[1]?.trim() ||
      null;

    return { title, author };
  } catch {
    return { title: fallbackTitle, author: null };
  }
}

/**
 * Scan public/free-books/*.epub, extract title + author from each file's OPF
 * metadata, and return display-ready book entries. Auto-updates when files are
 * added/removed/changed — the folder is the single source of truth.
 */
export async function loadFreeBooksCatalog(): Promise<FreeBook[]> {
  let files: string[];
  try {
    files = await readdir(FREE_BOOKS_DIR);
  } catch {
    return [];
  }

  const epubs = files.filter((f) => f.toLowerCase().endsWith(".epub")).sort();

  const books = await Promise.all(
    epubs.map(async (filename): Promise<FreeBook> => {
      const fullPath = path.join(FREE_BOOKS_DIR, filename);
      const fallback = filename.replace(/\.epub$/i, "").replace(/[-_]/g, " ");

      let title = fallback;
      let author: string | null = null;

      try {
        const st = await stat(fullPath);
        const mtime = st.mtimeMs;
        const cached = metaCache.get(filename);

        if (cached && cached.mtime === mtime) {
          title = cached.title;
          author = cached.author;
        } else {
          const meta = await extractEpubMeta(fullPath, fallback);
          title = meta.title;
          author = meta.author;
          metaCache.set(filename, { mtime, title, author });
        }
      } catch {
        // stat or parse failed — use fallback, no cache entry
      }

      return {
        id: filename.replace(/\.epub$/i, ""),
        title,
        author,
        coverUrl: `/api/free-books/cover/${encodeURIComponent(filename)}`,
        epubUrl: `${FREE_BOOKS_URL}/${filename}`,
        source: "Free / Public Domain",
        sourceUrl: null,
      };
    }),
  );

  return books;
}
