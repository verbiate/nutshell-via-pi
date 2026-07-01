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

type Leaf = { href: string; label: string; hasSubitems: boolean };

/**
 * Collect ToC leaves depth-first in reading order. Each leaf becomes one
 * playlist entry. The fragment (if any) is preserved on the href so the
 * playlist can address sub-chapter verses individually (e.g. the Analects,
 * whose flat ToC points 499 verse entries into ~24 shared XHTML files).
 */
function collectLeaves(items: NavItem[], out: Leaf[]) {
  for (const item of items) {
    const hasSubitems = !!item.subitems?.length;
    // ponytail: remember whether this leaf is a structural parent. The
    // fragment-dedup below drops flat redundant headings (Analects) but must
    // keep bare-href parents (Blitzscaling "Part I") whose href addresses
    // distinct intro content ahead of their first fragment child.
    if (item.href) {
      out.push({ href: item.href, label: item.label, hasSubitems });
    }
    if (hasSubitems) collectLeaves(item.subitems!, out);
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
    // ponytail: when verses (#fragments) subdivide a file, a flat bare-href
    // heading is redundant — it points at the same spot as the first verse.
    // Drop those (Analects). But keep a bare-href leaf that is a STRUCTURAL
    // parent (has subitems): its href addresses distinct intro content ahead
    // of the first fragment child (Blitzscaling "Part I"), and the TTS text
    // extractor bounds its range at that first child. Files with no fragments
    // keep their single bare entry.
    const hasFragment = matched.some((l) => l.href.includes("#"));
    const effective = hasFragment
      ? matched.filter((l) => l.href.includes("#") || l.hasSubitems)
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

/**
 * Fragment id of the next flatToc leaf after `href` that lives in the SAME
 * spine file. Used by TTS text extraction to bound a section's range at the
 * next ToC leaf rather than the next DOM id'd element — which may be a
 * sub-section heading NOT in the ToC (e.g. Blitzscaling's s16/s17/s18 sit
 * under s15 "The Three Basics of Blitzscaling" in the DOM but are absent from
 * the ToC; bounding at s16 truncated s15 to just its intro paragraph).
 *
 * Returns undefined when `href` isn't in the flatToc, or when the next entry
 * belongs to a different file (genuine chapter end → caller falls back to
 * DOM auto-discovery via findNextAnchoredElement, which correctly runs to the
 * file's end).
 */
export function nextLeafFragmentInSameFile(
  flatToc: FlatSection[],
  href: string,
): string | undefined {
  const base = basename(href);
  const frag = href.split("#")[1] ?? "";
  const idx = flatToc.findIndex(
    (s) => basename(s.href) === base && (s.href.split("#")[1] ?? "") === frag,
  );
  if (idx < 0) return undefined;
  const next = flatToc[idx + 1];
  if (!next || basename(next.href) !== base) return undefined;
  const nextFrag = next.href.split("#")[1] ?? "";
  return nextFrag || undefined;
}

// ponytail: normalize an href into (basename, fragment) for matching. Mirrors
// ttsSectionMatches's normalization (strip ?query; basename strips path) so the
// fragment-aware compare below stays robust to OEBPS/ vs bare path differences.
function hrefParts(href: string): { base: string; frag: string } {
  const clean = href.split("?")[0].trim();
  const hashIdx = clean.indexOf("#");
  const base =
    (hashIdx >= 0 ? clean.slice(0, hashIdx) : clean).split("/").pop() ?? clean;
  // ponytail: keep the leading "#" so bare (no fragment) and "#frag" compare
  // distinct — "" vs "#s13" must NOT match.
  const frag = hashIdx >= 0 ? clean.slice(hashIdx) : "";
  return { base, frag };
}

/**
 * Fragment-aware index of `href` in `flatToc`. Prefers an exact basename +
 * fragment match, then falls back to basename-only for resilience.
 *
 * Why this exists separately from ttsSectionMatches: a bare-href structural
 * parent (Blitzscaling "Part I", no fragment) and its fragment children share a
 * basename, and ttsSectionMatches intentionally collapses them to a match for
 * same-file detection. Using findIndex(ttsSectionMatches) for "where am I in
 * the playlist" returns the parent first, so advancing from a child re-resolves
 * to the current child and "Next" restarts it. The exact pass here pins the
 * child; the basename fallback preserves prior behavior when no fragment is
 * involved (front matter, plain chapter files).
 */
export function findFlatSectionIndex(
  flatToc: { href: string }[],
  href: string,
): number {
  const want = hrefParts(href);
  for (let i = 0; i < flatToc.length; i++) {
    const p = hrefParts(flatToc[i].href);
    if (p.base === want.base && p.frag === want.frag) return i;
  }
  return flatToc.findIndex((s) => hrefParts(s.href).base === want.base);
}
