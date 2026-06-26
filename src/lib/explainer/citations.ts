// ponytail: pure citation core for explainer deep links. No React, no DB —
// the deterministic, fully-tested boundary. Components compose these fns.

export type Citation = { label: string; href: string };
export type DiscussionLink = Citation & { spineIndex: number };
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

/** Aggregate citations across many message texts: drop invalid hrefs, dedupe
 *  by basename (first occurrence wins), sort by spine reading order. */
export function aggregateLinks(
  texts: string[],
  spineItems: { href: string; index: number }[]
): DiscussionLink[] {
  const indexByBasename = new Map<string, number>();
  for (const s of spineItems) {
    const b = hrefBasename(s.href);
    if (b && !indexByBasename.has(b)) indexByBasename.set(b, s.index);
  }
  const seen = new Set<string>();
  const links: DiscussionLink[] = [];
  for (const text of texts) {
    for (const c of parseCitations(text)) {
      const b = hrefBasename(c.href);
      const idx = indexByBasename.get(b);
      if (idx === undefined) continue;
      if (seen.has(b)) continue;
      seen.add(b);
      links.push({ label: c.label, href: c.href, spineIndex: idx });
    }
  }
  links.sort((a, z) => a.spineIndex - z.spineIndex);
  return links;
}

// ponytail: self-check. Run: npx tsx src/lib/explainer/citations.ts
if (process.argv[1]?.endsWith("citations.ts")) {
  const c = parseCitations("see [Chapter One](#ch:chapter1.xhtml) and [Two](#ch:c2.xhtml)");
  if (c.length !== 2) throw new Error("parseCitations failed");
  if (!isValidHref("chapter1.xhtml", ["OEBPS/chapter1.xhtml"])) throw new Error("isValidHref true");
  if (isValidHref("nope.xhtml", ["chapter1.xhtml"])) throw new Error("isValidHref false");
  const agg = aggregateLinks(
    ["[A](#ch:c2.xhtml) [B](#ch:c1.xhtml)", "[dup](#ch:c2.xhtml)"],
    [
      { href: "c1.xhtml", index: 0 },
      { href: "c2.xhtml", index: 5 },
    ]
  );
  if (agg.length !== 2 || agg[0].href !== "c1.xhtml" || agg[1].href !== "c2.xhtml") {
    throw new Error("aggregateLinks failed");
  }
  console.log("citations self-check OK");
}
