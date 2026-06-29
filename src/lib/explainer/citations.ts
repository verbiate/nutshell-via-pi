// ponytail: pure citation core for explainer deep links. No React, no DB —
// the deterministic, fully-tested boundary. Components compose these fns.

export type Citation = { label: string; href: string };
export type Segment =
  | { type: "text"; value: string }
  | { type: "link"; label: string; href: string };

/** Only the #ch: scheme is honored — explainers stay citation-only, never an
 *  arbitrary external-link vector. */
const CITE_RE = /\[([^\]]+)\]\(#ch:([^)\s]+)\)/g;

/** Normalize an href to its basename for spine matching. Mirrors the
 *  basename convention in lib/reader/spine-playlist.ts so ToC hrefs (which
 *  may carry path/fragment noise) resolve against spine hrefs cleanly. */
export function hrefBasename(href: string): string {
  return href.split("#")[0].split("?")[0].split("/").pop() ?? "";
}

/**
 * ponytail: discriminate a cross-book citation href from an origin-book
 * basename. cuid() emits ~24-char base36 ids; the ^[a-z0-9]{8,}: floor is
 * unambiguous against any real EPUB spine basename (none start with 8+
 * lowercase-alphanumerics followed by ":"). Returns bookId null for the
 * origin-book form so callers fall through to today's within-book path.
 * Splits on the FIRST ":" only — basenames should never contain ":", but
 * the split is defensive.
 */
const BOOK_PREFIX_RE = /^[a-z0-9]{8,}:/;
export function parseBookRef(
  href: string
): { bookId: string | null; basename: string } {
  if (!href) return { bookId: null, basename: "" };
  const m = href.match(BOOK_PREFIX_RE);
  if (!m) return { bookId: null, basename: href };
  const bookId = m[0].slice(0, -1); // strip trailing ":"
  return { bookId, basename: href.slice(m[0].length) };
}

export function parseCitations(text: string): Citation[] {
  const out: Citation[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    out.push({ label: m[1], href: m[2] });
  }
  return out;
}

export function isValidHref(href: string, spineHrefs: string[]): boolean {
  const b = hrefBasename(href);
  if (!b) return false;
  return spineHrefs.some((s) => hrefBasename(s) === b);
}

/**
 * Resolve a citation href to the FULL spine href that rendition.display()
 * needs. The model emits bare basenames (the {{chapter_index}} manifest emits
 * basenames), but epub.js spine.get() only has a decodeURI fallback — no
 * basename match — so a bare basename dead-jumps on prefixed-spine EPUBs
 * (OEBPS/..., Text/...). epub-viewer normalizes ToC hrefs at load via
 * resolveSpineHref; citations need the same treatment at the nav boundary.
 * Returns the input unchanged when nothing matches (graceful — display
 * fail-softs, never throws).
 */
export function resolveToSpineHref(target: string, spineHrefs: string[]): string {
  if (!target) return target;
  const b = hrefBasename(target);
  if (!b) return target;
  for (const h of spineHrefs) {
    if (hrefBasename(h) === b) return h;
  }
  return target;
}

/**
 * ponytail: like resolveToSpineHref but returns null on no match instead of
 * the input unchanged — so the navigation boundary can REFUSE to display a
 * citation whose basename isn't in the live spine, rather than handing the
 * bare basename to rendition.display() and dead-jumping to section start.
 * The consume boundary is the source of truth: click-time validation for
 * cross-book citations can only check tocJson (DB), which can drift from the
 * live spine; this guard resolves against the same spine display() uses.
 */
export function resolveCitationHrefOrNull(
  href: string,
  spineHrefs: string[]
): string | null {
  if (!href) return null;
  const b = hrefBasename(href);
  if (!b) return null;
  for (const h of spineHrefs) {
    if (hrefBasename(h) === b) return h;
  }
  return null;
}

export function segmentText(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ type: "text", value: text.slice(last, idx) });
    segments.push({ type: "link", label: m[1], href: m[2] });
    last = idx + m[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

// ponytail: self-check. Run: npx tsx src/lib/explainer/citations.ts
if (process.argv[1]?.endsWith("citations.ts")) {
  const c = parseCitations("see [Chapter One](#ch:chapter1.xhtml) and [Two](#ch:c2.xhtml)");
  if (c.length !== 2) throw new Error("parseCitations failed");
  if (!isValidHref("chapter1.xhtml", ["OEBPS/chapter1.xhtml"])) throw new Error("isValidHref true");
  if (isValidHref("nope.xhtml", ["chapter1.xhtml"])) throw new Error("isValidHref false");
  const cross = parseCitations("[Ch3](#ch:ck1abc2def3ghi4jkl:chapter3.xhtml)");
  if (cross[0]?.href !== "ck1abc2def3ghi4jkl:chapter3.xhtml") throw new Error("cross href capture failed");
  const ref = parseBookRef("ck1abc2def3ghi4jkl:chapter3.xhtml");
  if (ref.bookId !== "ck1abc2def3ghi4jkl" || ref.basename !== "chapter3.xhtml") throw new Error("parseBookRef prefixed failed");
  if (parseBookRef("chapter1.xhtml").bookId !== null) throw new Error("parseBookRef origin should be null");
if (parseBookRef("part1:x.xhtml").bookId !== null) throw new Error("parseBookRef short prefix should be null");
if (resolveCitationHrefOrNull("nope.xhtml", ["OEBPS/chapter1.xhtml"]) !== null) throw new Error("resolveCitationHrefOrNull should return null on no match");
if (resolveCitationHrefOrNull("chapter1.xhtml", ["OEBPS/chapter1.xhtml"]) !== "OEBPS/chapter1.xhtml") throw new Error("resolveCitationHrefOrNull should resolve basename");
if (resolveCitationHrefOrNull("", ["OEBPS/chapter1.xhtml"]) !== null) throw new Error("resolveCitationHrefOrNull should return null on empty");
console.log("citations self-check OK");
}
