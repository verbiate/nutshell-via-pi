export interface HighlightColor {
  key: string;
  hex: string;
  label: string;
}

// ponytail: the three highlighter colors used across the app (menu + panel).
// Bright, saturated set per design spec.
export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { key: "teal", hex: "#19E1CA", label: "Teal" },
  { key: "yellow", hex: "#FEC405", label: "Yellow" },
  { key: "pink", hex: "#F168F5", label: "Pink" },
];

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[1].hex;

export function highlightColorLabel(hex: string): string {
  return (
    HIGHLIGHT_COLORS.find(
      (c) => c.hex.toLowerCase() === hex.toLowerCase()
    )?.label ?? "Highlight"
  );
}
