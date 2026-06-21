/**
 * Reading-progress percentage helper.
 *
 * epub.js populates `location.start.percentage` only after `book.locations.generate()`
 * has run. This helper turns a CFI into a clamped 0–100 percentage using
 * `book.locations.percentageFromCfi`, which is the testable surface.
 */

export interface BookLike {
  locations: {
    percentageFromCfi(cfi: string): number | null;
  };
}

/**
 * Compute reading progress as a percentage in [0, 100].
 * Returns 0 for null/empty CFI or when locations aren't generated yet.
 */
export function computeProgressPercent(
  book: BookLike,
  cfi: string | null,
): number {
  if (!cfi) return 0;
  const pct = book.locations.percentageFromCfi(cfi);
  if (pct == null) return 0;
  return Math.min(100, Math.max(0, pct * 100));
}

/**
 * Decide whether a freshly-emitted percentage should replace the displayed one.
 *
 * epub.js's `relocated` event fires multiple times per page turn (next/prev,
 * post-display, SCROLLED, RESIZED) and each call measures `mapping.start` in a
 * rAF — so during spine-boundary crossings or transition states, the captured
 * CFI can briefly land on an adjacent page in the *wrong direction*. Diagnostic
 * trace from Creativity, Inc. showed: forward-nav emits a brief 45% while
 * settling at 46%; backward-nav emits a brief 46% while settling at 45%.
 *
 * The fix is a direction-aware tolerance window. When the user takes a directed
 * action (next/prev), tag it with a direction and a timestamp. Within ~500 ms,
 * reject emissions that move opposite the direction. Outside the window or for
 * undirected actions (TOC/search/bookmark jumps), accept everything — those
 * don't have transient directional wobble.
 *
 * ponytail: ceiling — a wobble that lands *in the same direction* as the action
 * (e.g. forward wobble during forward nav, 46→47→46 settling) is accepted and
 * the user sees a brief overshoot. Acceptable: those are rare and small.
 * Upgrade path: also track expected delta per action and reject overshoots.
 */
export function shouldDisplayProgress(
  next: number,
  displayed: number,
  actionDir: "forward" | "backward" | null,
  sinceActionMs: number,
  windowMs: number = 500,
): boolean {
  if (actionDir === null || sinceActionMs >= windowMs) return true;
  if (actionDir === "forward" && next < displayed) return false;
  if (actionDir === "backward" && next > displayed) return false;
  return true;
}
