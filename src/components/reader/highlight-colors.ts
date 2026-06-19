import type { CSSProperties } from "react";

export interface HighlightColor {
  key: string;
  hex: string;
  label: string;
}

// ponytail: the three highlighter colors used across the app (menu + panel).
// There is NO default — a user must pick one of these to create a highlight.
// Rendered at 50% alpha with mix-blend-mode: multiply — use highlightFill()
// for the in-book annotation fill and highlightSwatchStyle for UI swatches.
export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { key: "teal", hex: "#34E1CD", label: "Teal" },
  { key: "yellow", hex: "#FEC405", label: "Yellow" },
  { key: "pink", hex: "#F168F5", label: "Pink" },
];

// The complete set of valid highlight colors. Single source of truth for
// server-side validation (a highlight requires one of these, explicitly).
export const HIGHLIGHT_COLOR_HEXES: ReadonlySet<string> = new Set(
  HIGHLIGHT_COLORS.map((c) => c.hex.toLowerCase()),
);

export function isValidHighlightColor(hex: string): boolean {
  return HIGHLIGHT_COLOR_HEXES.has(hex.toLowerCase());
}

export const HIGHLIGHT_ALPHA = 0.5;

// hex (#RRGGBB) → rgba() at HIGHLIGHT_ALPHA, for epub.js annotation fills.
export function highlightFill(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${HIGHLIGHT_ALPHA})`;
}

// Inline style for a highlight swatch: 50% alpha color + multiply blend.
export function highlightSwatchStyle(hex: string): CSSProperties {
  return {
    backgroundColor: highlightFill(hex),
    mixBlendMode: "multiply",
  };
}

export function highlightColorLabel(hex: string): string {
  return (
    HIGHLIGHT_COLORS.find(
      (c) => c.hex.toLowerCase() === hex.toLowerCase()
    )?.label ?? "Highlight"
  );
}
