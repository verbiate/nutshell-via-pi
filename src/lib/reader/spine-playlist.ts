import type { NavItem } from "@likecoin/epub-ts";

export type SpineItem = {
  href: string;
  index: number;
  linear?: boolean;
};

export type FlatSection = {
  label: string;
  href: string;
  index: number;
};

function basename(href: string): string {
  return href.split("#")[0].split("?")[0].split("/").pop() ?? "";
}

type Leaf = { href: string; label: string };

/**
 * Collect ToC leaves depth-first in reading order. Each leaf becomes one
 * playlist entry. The fragment (if any) is preserved on the href so the
 * playlist can address sub-chapter verses individually (e.g. the Analects,
 * whose flat ToC points 499 verse entries into ~24 shared XHTML files).
 */
function collectLeaves(items: NavItem[], out: Leaf[]) {
  for (const item of items) {
    if (item.href) {
      out.push({ href: item.href, label: item.label });
    }
    if (item.subitems?.length) collectLeaves(item.subitems, out);
  }
}

/**
 * Build the TTS playback playlist. One entry per ToC leaf (fragment-aware),
 * grouped by spine file in true reading order. Spine items with no ToC leaf
 * (front matter, or continuation splits of a multi-file chapter) emit one
 * entry each — labeled "(continued)" off the most recent leaf so multi-file
 * chapters still read through, unnamed front matter stays blank.
 *
 * Downstream text extraction (extractSectionText, viewer.getSectionText)
 * honors the #fragment to bound TTS to that verse, so the existing
 * ENDED → auto-advance path moves leaf-by-leaf without special-casing.
 */
export function buildSpinePlaylist(
  spine: SpineItem[],
  toc: NavItem[],
): FlatSection[] {
  // ponytail: O(n) basename lookup. ToC hrefs may carry #fragments and path
  // prefixes the spine omits; basename is the stable spine identity.
  const linearSpine = spine.filter((s) => s.linear !== false);
  const leaves: Leaf[] = [];
  collectLeaves(toc, leaves);

  const playlist: FlatSection[] = [];
  const seen = new Set<string>();
  let prevLabel = "";

  for (const section of linearSpine) {
    const base = basename(section.href);
    if (!base) continue;
    const matched = leaves.filter((l) => basename(l.href) === base);
    // ponytail: when verses (#fragments) subdivide a file, bare-href leaves
    // are chapter headings — emitting both would read the whole file then
    // re-read the first verse on advance. Drop the bare headings; keep all
    // fragments. Files with no fragments keep their single bare entry.
    const hasFragment = matched.some((l) => l.href.includes("#"));
    const effective = hasFragment
      ? matched.filter((l) => l.href.includes("#"))
      : matched;
    if (effective.length === 0) {
      // ponytail: orphan spine item — no ToC leaf points here. Emit it so the
      // file is still playable in sequence; carry the prior leaf's label as
      // "(continued)" so multi-file chapters (Calibre splits) keep their
      // chapter title. Front matter before any leaf stays blank.
      const href = section.href;
      if (seen.has(href)) continue;
      seen.add(href);
      const label = prevLabel ? `${prevLabel} (continued)` : "";
      playlist.push({ href, label, index: playlist.length });
      continue;
    }
    for (const leaf of effective) {
      // ponytail: dedup — some EPUBs repeat nav points; first occurrence wins.
      if (seen.has(leaf.href)) continue;
      seen.add(leaf.href);
      playlist.push({ href: leaf.href, label: leaf.label, index: playlist.length });
      prevLabel = leaf.label;
    }
  }

  return playlist;
}
