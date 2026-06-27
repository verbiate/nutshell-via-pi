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
  console.log("citations self-check OK");
}
