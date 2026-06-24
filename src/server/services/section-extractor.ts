import { storage } from "@/server/storage/local";
import { htmlToTtsText } from "@/lib/tts/prepare-text";

// ponytail: rewritten to bypass @likecoin/epub-ts. Its Book.spine.load() path
// needs DOMParser (browser API) — unavailable in Node, caused "DOMParser is
// not defined" on section explainer requests. Uses the same JSZip + regex
// HTML-stripping pattern as epub-processor.ts:180-233. No DOM dependency.

/**
 * Extract the plain text of a single EPUB section (spine item) by href.
 *
 * `sectionHref` may be relative (`chapter2.xhtml`), rooted (`OEBPS/chapter2.xhtml`),
 * or include a fragment (`chapter2.xhtml#section`). We normalize and match
 * against manifest entries to find the right ZIP entry, then strip its HTML.
 */
export async function extractSectionText(
  epubPath: string,
  sectionHref: string,
  opts?: { forTts?: boolean }
): Promise<string> {
  const epubBuffer = await storage.read(epubPath);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(epubBuffer);

  // Locate OPF via container.xml
  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  if (!containerXml) {
    throw new Error("Invalid EPUB: missing META-INF/container.xml");
  }
  const rootfilePathMatch = containerXml.match(/full-path="([^"]+\.opf)"/i);
  if (!rootfilePathMatch) {
    throw new Error("Invalid EPUB: cannot find rootfile in container.xml");
  }
  const rootfilePath = rootfilePathMatch[1];
  const rootDir = rootfilePath.includes("/")
    ? rootfilePath.substring(0, rootfilePath.lastIndexOf("/") + 1)
    : "";

  const opfContent = await zip.file(rootfilePath)?.async("text");
  if (!opfContent) {
    throw new Error("Invalid EPUB: cannot read OPF file");
  }

  // Build manifest: id → { href, full path }
  const manifest = parseManifest(opfContent);
  const cleanHref = sectionHref.split("#")[0];

  // Match the section's manifest entry. Try several normalizations because
  // TOC hrefs vary across EPUBs (relative, rooted, with/without fragment).
  const match = findManifestEntry(manifest, cleanHref, rootDir);
  if (!match) {
    throw new Error(`Section not found in EPUB spine: ${sectionHref}`);
  }

  const fullPath = rootDir + match.href;
  const content = await zip.file(fullPath)?.async("text");
  if (!content) {
    throw new Error(`Section file not found in EPUB: ${fullPath}`);
  }

  return opts?.forTts ? htmlToTtsText(content) : stripHtml(content).trim();
}

// ─── Helpers (mirror epub-processor.ts patterns) ───────────────────────────

type ManifestItem = {
  id: string;
  href: string;
  mediaType?: string;
  properties?: string;
};

function parseManifest(opfContent: string): ManifestItem[] {
  const tags = opfContent.match(/<item\b[^>]*>/gi) || [];
  const items: ManifestItem[] = [];
  for (const t of tags) {
    const id = getAttr(t, "id");
    const href = getAttr(t, "href");
    if (!id || !href) continue;
    items.push({
      id,
      href,
      mediaType: getAttr(t, "media-type"),
      properties: getAttr(t, "properties"),
    });
  }
  return items;
}

function findManifestEntry(
  manifest: ManifestItem[],
  cleanHref: string,
  rootDir: string
): ManifestItem | null {
  // Decode URL-encoded hrefs (some EPUBs use %20 etc.)
  const decoded = safeDecode(cleanHref);
  for (const item of manifest) {
    const itemHref = safeDecode(item.href);
    // Direct match
    if (itemHref === decoded) return item;
    // With root dir prefix
    if (rootDir + itemHref === decoded) return item;
    // TOC href includes root dir but manifest doesn't (or vice versa)
    if (decoded.endsWith("/" + itemHref) || itemHref.endsWith("/" + decoded)) {
      // Additional sanity: the longer must start with the shorter
      const longer = decoded.length > itemHref.length ? decoded : itemHref;
      const shorter = decoded.length > itemHref.length ? itemHref : decoded;
      if (longer.endsWith(shorter)) return item;
    }
  }
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function getAttr(tag: string, attr: string): string | undefined {
  const re = new RegExp(`\\b${attr}="([^"]*)"`, "i");
  return tag.match(re)?.[1];
}

function stripHtml(content: string): string {
  // ponytail: same regex chain as epub-processor.ts:214-225 — works server-side
  // without DOMParser. Strips styles/scripts/tags, decodes common entities,
  // collapses whitespace.
  return content
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ");
}
