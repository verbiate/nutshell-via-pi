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

function normHref(href: string): string {
  return href.split("#")[0].split("?")[0];
}

function basename(href: string): string {
  return normHref(href).split("/").pop() ?? "";
}

/**
 * Build the TTS playback playlist from the EPUB spine (true reading order),
 * labeling each item by the most recent ToC entry that resolves to it.
 * Spine items with no matching ToC entry inherit their chapter's label with
 * "(continued)" appended, so multi-file chapters are read in full instead of
 * jumping from the heading page to the next ToC entry.
 */
export function buildSpinePlaylist(
  spine: SpineItem[],
  toc: NavItem[],
): FlatSection[] {
  // ponytail: O(n) basename lookup. ToC hrefs may carry #fragments and path
  // prefixes the spine omits; basename is the stable spine identity.
  const spineByBasename = new Map<string, SpineItem>();
  for (const section of spine) {
    const b = basename(section.href);
    if (b && !spineByBasename.has(b)) {
      spineByBasename.set(b, section);
    }
  }

  const labelBySpineIndex = new Map<number, string>();
  function walk(items: NavItem[]) {
    for (const item of items) {
      const b = basename(item.href);
      if (b) {
        const section = spineByBasename.get(b);
        if (section && !labelBySpineIndex.has(section.index)) {
          labelBySpineIndex.set(section.index, item.label);
        }
      }
      if (item.subitems?.length) walk(item.subitems);
    }
  }
  walk(toc);

  const playlist: FlatSection[] = [];
  let currentLabel = "";
  for (const section of spine) {
    if (section.linear === false) continue;

    const label = labelBySpineIndex.get(section.index);
    if (label) {
      currentLabel = label;
      playlist.push({ href: section.href, label, index: playlist.length });
    } else if (currentLabel) {
      playlist.push({
        href: section.href,
        label: `${currentLabel} (continued)`,
        index: playlist.length,
      });
    } else {
      // Front matter before the first ToC entry; still playable, just unnamed.
      playlist.push({ href: section.href, label: "", index: playlist.length });
    }
  }

  return playlist;
}
