export type ParamValue = string | number;
export type DefaultParams = Readonly<Record<string, ParamValue>>;

type Format = "raw" | "px" | "rem" | "ms" | "percent" | "ch" | "em" | "unitless";
type Target = "root" | "gallery";

interface ParamConfig {
  key: string;
  value: ParamValue;
  target: Target;
  format: Format;
}

const CONFIG: readonly ParamConfig[] = [
  { key: "tan", value: "#FEFBF5", target: "root", format: "raw" },
  { key: "tan-dark", value: "#DDD8CD", target: "root", format: "raw" },
  { key: "chocolate", value: "#402A08", target: "root", format: "raw" },
  { key: "chocolate-dark", value: "#221805", target: "root", format: "raw" },

  { key: "lav", value: "#A17FF0", target: "root", format: "raw" },
  { key: "lav-soft", value: "#D9D6FF", target: "root", format: "raw" },
  { key: "lav-ring", value: "#B8A8F5", target: "root", format: "raw" },

  { key: "peach", value: "#FE8050", target: "root", format: "raw" },
  { key: "pink", value: "#F168F5", target: "root", format: "raw" },
  { key: "purple", value: "#A17FF0", target: "root", format: "raw" },
  { key: "blue", value: "#18BDFD", target: "root", format: "raw" },
  { key: "teal", value: "#34E1CD", target: "root", format: "raw" },
  { key: "lavender", value: "#D9D6FF", target: "root", format: "raw" },

  { key: "b-orange", value: "#FE8050", target: "root", format: "raw" },
  { key: "b-magenta", value: "#F168F5", target: "root", format: "raw" },
  { key: "b-purple", value: "#A17FF0", target: "root", format: "raw" },
  { key: "b-blue", value: "#18BDFD", target: "root", format: "raw" },
  { key: "b-teal", value: "#34E1CD", target: "root", format: "raw" },

  { key: "hl-teal", value: "#34E1CD", target: "root", format: "raw" },
  { key: "hl-yellow", value: "#FEC405", target: "root", format: "raw" },
  { key: "hl-pink", value: "#F168F5", target: "root", format: "raw" },

  { key: "warn-from", value: "#F9241E", target: "root", format: "raw" },
  { key: "warn-to", value: "#F168F5", target: "root", format: "raw" },
  { key: "success-from", value: "#18BDFD", target: "root", format: "raw" },
  { key: "success-to", value: "#4FDB27", target: "root", format: "raw" },

  { key: "r-sm", value: 10, target: "root", format: "px" },
  { key: "r-md", value: 16, target: "root", format: "px" },
  { key: "r-lg", value: 22, target: "root", format: "px" },

  { key: "radius", value: 0.625, target: "root", format: "rem" },

  { key: "reader-rail-w", value: 94, target: "root", format: "px" },
  { key: "reader-sidebar-w", value: 400, target: "root", format: "px" },
  { key: "reader-dur", value: 250, target: "root", format: "ms" },

  { key: "book-hover-lift", value: 1, target: "gallery", format: "percent" },
  { key: "tts-bar-h", value: 64, target: "gallery", format: "px" },
  { key: "tts-bar-blur", value: 6, target: "gallery", format: "px" },
  { key: "toolbar-w", value: 220, target: "gallery", format: "px" },
  { key: "toolbar-shadow-y", value: 8, target: "gallery", format: "px" },

  // ponytail: prose typography — consumed by .ds-prose wrapper on /design-system
  // and the retrofitted intro / §09 reading sample. Defaults mirror the
  // screen-typography skill's macro recommendations (65ch measure, 1.5 leading)
  // and IBM Plex Serif's available OpenType features.
  { key: "prose-font-size", value: 18, target: "root", format: "px" },
  { key: "prose-line-height", value: 1.5, target: "root", format: "unitless" },
  { key: "prose-max-width", value: 65, target: "root", format: "ch" },
  // String-valued (discrete) keys below — Tweakpane binds these via `options`
  // dropdowns in page.tsx, not numeric sliders. format: "raw" writes them as-is.
  { key: "prose-font-family", value: "var(--font-serif)", target: "root", format: "raw" },
  { key: "prose-text-align", value: "left", target: "root", format: "raw" },
  { key: "prose-hyphens", value: "manual", target: "root", format: "raw" },
  { key: "prose-ligatures", value: "common-ligatures", target: "root", format: "raw" },
  { key: "prose-numeric", value: "oldstyle-nums proportional-nums", target: "root", format: "raw" },
  { key: "prose-optical", value: "auto", target: "root", format: "raw" },
];

const UNIT_SUFFIX: Record<Format, string> = {
  raw: "",
  px: "px",
  rem: "rem",
  ms: "ms",
  percent: "%",
  ch: "ch",
  em: "em",
  unitless: "",
};

function formatValue(value: ParamValue, format: Format): string {
  return `${value}${UNIT_SUFFIX[format]}`;
}

function buildSetter(cfg: ParamConfig): (value: ParamValue) => void {
  const cssVar = `--${cfg.key}`;
  if (cfg.target === "root") {
    return (value: ParamValue) => {
      document.documentElement.style.setProperty(cssVar, formatValue(value, cfg.format));
    };
  }
  return (value: ParamValue) => {
    const el = document.querySelector<HTMLElement>(".ds-gallery");
    if (el) el.style.setProperty(cssVar, formatValue(value, cfg.format));
  };
}

export const defaultParams: DefaultParams = Object.freeze(
  Object.fromEntries(CONFIG.map((c) => [c.key, c.value])),
);

export const applyParam: Record<string, (value: ParamValue) => void> =
  Object.fromEntries(CONFIG.map((c) => [c.key, buildSetter(c)]));
