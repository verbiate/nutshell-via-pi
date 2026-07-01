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
  // ponytail: split the #fragment off before manifest matching (hrefs in the
  // manifest never carry one), but keep it for sub-chapter extraction below.
  const [cleanHref, fragment] = splitFragment(sectionHref);

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

  // ponytail: when a #fragment is present, the anchor marks the START of a
  // range that extends to the next id'd element in the same file (the next
  // ToC anchor). Reading just the anchor's element would only yield one
  // paragraph for verse-structured books — section text must span everything
  // between anchors. Falls back to whole-file text if the id isn't found.
  const scoped = fragment
    ? extractRangeFromIdHtml(content, fragment) ?? content
    : content;

  return opts?.forTts ? htmlToTtsText(scoped) : stripHtml(scoped).trim();
}

function splitFragment(href: string): [string, string | null] {
  const idx = href.indexOf("#");
  return idx >= 0 ? [href.slice(0, idx), href.slice(idx + 1)] : [href, null];
}

/**
 * Return the inner HTML of the first element carrying `id="<id>"`, tracked by
 * tag-name depth so nested same-name descendants stay inside. null when the id
 * isn't found.
 *
 * ponytail: scanner, not a parser — no DOMParser in Node, no new dep. Known
 * ceilings: (1) malformed/unclosed tags fall through to "rest of document
 * after the open tag" (regex-based; rare in EPUBs produced by Calibre/Sigil);
 * (2) self-closing variants of the matched tag (e.g. `<div/>`) are treated as
 * opens — handled by requiring a separate close token, so a self-closer would
 * over-capture. Both degrade to "reads a bit more", never crash. Upgrade path
 * if measurable breakage: switch to cheerio.
 */
export function extractElementByIdHtml(
  content: string,
  id: string,
): string | null {
  if (!id) return null;
  // Locate the opening tag that owns the id. Handle double/single quotes and
  // tolerate attribute ordering (`id` may not be first).
  const tagRe = new RegExp(
    `<([a-zA-Z][\\w-]*)\\b[^>]*?\\bid\\s*=\\s*["']${escapeRegex(id)}["'][^>]*?(/?)>`,
  );
  const open = content.search(tagRe);
  if (open < 0) return null;
  const openMatch = content.slice(open).match(tagRe)!;
  const tagName = openMatch[1].toLowerCase();
  const selfClosed = openMatch[2] === "/";
  const tagStart = open;
  const afterOpenTag = open + openMatch[0].length;
  if (selfClosed) return "";

  // Walk forward counting depth of `tagName` open/close tags (other tag names
  // are irrelevant — we only care when our element's matching close appears).
  const openTagRe = new RegExp(`<${tagName}\\b`, "gi");
  const closeTagRe = new RegExp(`</${tagName}\\s*>`, "gi");
  // Re-scan from afterOpenTag so depth starts at 1 (the open tag itself).
  let depth = 1;
  let pos = afterOpenTag;
  let nextOpen: number;
  let nextClose: number;
  while (depth > 0) {
    openTagRe.lastIndex = pos;
    closeTagRe.lastIndex = pos;
    const o = openTagRe.exec(content);
    const c = closeTagRe.exec(content);
    nextOpen = o ? o.index : Infinity;
    nextClose = c ? c.index : Infinity;
    if (nextClose === Infinity) {
      // ponytail: unclosed element — return from the open tag to end of doc.
      return content.slice(afterOpenTag);
    }
    if (nextOpen < nextClose) {
      depth++;
      pos = openTagRe.lastIndex;
    } else {
      depth--;
      pos = closeTagRe.lastIndex;
      if (depth === 0) {
        return content.slice(afterOpenTag, nextClose);
      }
    }
  }
  return content.slice(afterOpenTag, afterOpenTag); // unreachable
}

/**
 * Return the outer HTML from the element carrying `id="<startId>"` up to (but
 * not including) the next opening tag — STRICTLY AFTER the start element's own
 * subtree — that carries any non-empty `id` attribute. Used to scope TTS text
 * to a *range*: the ToC anchor marks the START of a section; the next anchor
 * in the same file ends it. Without this, verse-structured books would read
 * only the one paragraph the anchor points at.
 *
 * Returns null when `startId` isn't found (caller falls back to whole file).
 *
 * ponytail: scanner, not a parser. Same ceilings as `extractElementByIdHtml`:
 * malformed/unclosed tags fall through to rest-of-document. Both degrade to
 * "reads a bit more", never crash. Upgrade path if measurable breakage:
 * switch to cheerio.
 *
 * Subtree skip: EPUBs embed unrelated ids inside section wrappers (footnote
 * refs, pagebreak spans like `<span id="page_47"/>`, figure anchors). Without
 * skipping the start element's own subtree first, the next-id search would
 * match a nested id and truncate the range prematurely. We find the start
 * element's close tag (depth-tracking walk, same logic as
 * `extractElementByIdHtml`) and search for the next id'd tag from THAT
 * position onward.
 */
export function extractRangeFromIdHtml(
  content: string,
  startId: string,
): string | null {
  if (!startId) return null;
  // Locate the opening tag carrying startId.
  const startTagRe = new RegExp(
    `<([a-zA-Z][\\w-]*)\\b[^>]*?\\bid\\s*=\\s*["']${escapeRegex(startId)}["'][^>]*?(/?)>`,
  );
  const startMatch = content.match(startTagRe);
  if (!startMatch) return null;
  const startOpen = startMatch.index!;
  const tagName = startMatch[1].toLowerCase();
  const selfClosed = startMatch[2] === "/";
  const afterOpenTag = startOpen + startMatch[0].length;

  // ponytail: find where the start element ENDS (its closing tag). For
  // self-closing tags, the close position is the same as afterOpenTag. For
  // normal tags, walk forward counting same-tagName depth — same algorithm as
  // extractElementByIdHtml (reused, not re-extracted, because we need the
  // close POSITION, not the inner content).
  let afterSubtree = afterOpenTag;
  if (!selfClosed) {
    const openTagRe = new RegExp(`<${tagName}\\b`, "gi");
    const closeTagRe = new RegExp(`</${tagName}\\s*>`, "gi");
    let depth = 1;
    let pos = afterOpenTag;
    while (depth > 0) {
      openTagRe.lastIndex = pos;
      closeTagRe.lastIndex = pos;
      const o = openTagRe.exec(content);
      const c = closeTagRe.exec(content);
      const nextOpen = o ? o.index : Infinity;
      const nextClose = c ? c.index : Infinity;
      if (nextClose === Infinity) {
        // ponytail: unclosed start tag — read to end of doc.
        return content.slice(startOpen);
      }
      if (nextOpen < nextClose) {
        depth++;
        pos = openTagRe.lastIndex;
      } else {
        depth--;
        pos = closeTagRe.lastIndex;
        if (depth === 0) {
          afterSubtree = pos;
          break;
        }
      }
    }
  }

  // Search forward from `afterSubtree` for the next opening tag carrying any
  // non-empty id. This is the next ToC anchor strictly after `start`'s subtree.
  const anyIdTagRe =
    /<[a-zA-Z][\w-]*\b[^>]*?\bid\s*=\s*["'][^"']+["'][^>]*?>/g;
  anyIdTagRe.lastIndex = afterSubtree;
  const next = anyIdTagRe.exec(content);
  if (!next) {
    // ponytail: no next anchor after `start` — read to end of file.
    return content.slice(startOpen);
  }
  return content.slice(startOpen, next.index);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  // ponytail: basename fallback mirrors spine-playlist.ts:38-42; first match
  // wins — disambiguate by spine order if a manifest ever has two items with
  // the same basename in different dirs.
  const base = basename(decoded);
  if (base) {
    for (const item of manifest) {
      if (basename(safeDecode(item.href)) === base) return item;
    }
  }
  return null;
}

function basename(href: string): string {
  return href.split("#")[0].split("?")[0].split("/").pop() ?? "";
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
