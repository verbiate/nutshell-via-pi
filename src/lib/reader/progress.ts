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
