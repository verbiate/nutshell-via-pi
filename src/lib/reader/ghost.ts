import type { FlatSection } from "@/lib/reader/spine-playlist";
import type { PlaylistItem } from "@/types/playlist";

export type GhostItem = { sectionHref: string; sectionLabel: string };

export type AdvanceDecision =
  | { kind: "ghost" }
  | { kind: "manual"; item: PlaylistItem }
  | { kind: "terminal" }
  | { kind: "idle" };

/**
 * Index of the first readable spine section strictly after `currentIndex`,
 * within the readable window [startIndex, endIndex]. Null when the active
 * section is at or past the readable end (ghost exhausted), or the window is
 * invalid. When `currentIndex` falls before the window (front matter), the
 * ghost is the window start.
 */
export function ghostOffset(
  currentIndex: number,
  startIndex: number,
  endIndex: number,
  len: number,
): number | null {
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) return null;
  const ghostIdx = Math.max(currentIndex + 1, startIndex);
  if (ghostIdx > endIndex || ghostIdx >= len || ghostIdx < 0) return null;
  return ghostIdx;
}

/**
 * Resolve the ghost to a concrete {href, label} by locating the readable
 * bounds in `flatToc` via `matchFn` (basename-aware compare). Null bounds
 * mean "no pin" -> the whole spine is the window.
 */
export function resolveGhostItem(
  flatToc: FlatSection[],
  currentIndex: number,
  startHref: string | null,
  endHref: string | null,
  matchFn: (a: string, b: string) => boolean,
): GhostItem | null {
  const len = flatToc.length;
  if (len === 0) return null;
  const startIndex = startHref
    ? flatToc.findIndex((s) => matchFn(s.href, startHref))
    : 0;
  const endIndex = endHref
    ? flatToc.findIndex((s) => matchFn(s.href, endHref))
    : len - 1;
  const off = ghostOffset(currentIndex, startIndex, endIndex, len);
  if (off == null) return null;
  const s = flatToc[off];
  return { sectionHref: s.href, sectionLabel: s.label };
}

/**
 * Precedence: ghost -> manual next -> terminal -> idle. Pure; callers perform
 * the side effects (promote ghost / activate item / mark finished / no-op).
 */
export function resolveAdvance(opts: {
  ghostItem: GhostItem | null;
  manualNext: PlaylistItem | null;
  atReadableEnd: boolean;
  atEndOfToc: boolean;
}): AdvanceDecision {
  if (opts.ghostItem) return { kind: "ghost" };
  if (opts.manualNext) return { kind: "manual", item: opts.manualNext };
  if (opts.atReadableEnd || opts.atEndOfToc) return { kind: "terminal" };
  return { kind: "idle" };
}
