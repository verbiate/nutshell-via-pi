export type ParamValue = string | number;
export type DefaultParams = Readonly<Record<string, ParamValue>>;

type Format = "raw" | "px" | "rem" | "ms" | "percent";
type Target = "root" | "gallery";

interface ParamConfig {
  key: string;
  value: ParamValue;
  target: Target;
  format: Format;
}

const CONFIG: readonly ParamConfig[] = [
  { key: "paper", value: "#FBF7EC", target: "root", format: "raw" },
  { key: "paper-deep", value: "#F4EEDC", target: "root", format: "raw" },
  { key: "espresso", value: "#2B1C11", target: "root", format: "raw" },
  { key: "ink", value: "#33271B", target: "root", format: "raw" },
  { key: "line", value: "#E7DFCC", target: "root", format: "raw" },
  { key: "line-soft", value: "#EFE9D8", target: "root", format: "raw" },

  { key: "lav", value: "#7E70EA", target: "root", format: "raw" },
  { key: "lav-soft", value: "#ECE8FB", target: "root", format: "raw" },
  { key: "lav-ring", value: "#C8C1F4", target: "root", format: "raw" },

  { key: "g1", value: "#FF7A4D", target: "root", format: "raw" },
  { key: "g2", value: "#FF4E8C", target: "root", format: "raw" },
  { key: "g3", value: "#C932A6", target: "root", format: "raw" },

  { key: "b-orange", value: "#FF7A4D", target: "root", format: "raw" },
  { key: "b-magenta", value: "#E541C9", target: "root", format: "raw" },
  { key: "b-purple", value: "#8A6FE8", target: "root", format: "raw" },
  { key: "b-blue", value: "#2EA6F0", target: "root", format: "raw" },
  { key: "b-teal", value: "#3FD9B0", target: "root", format: "raw" },

  { key: "hl-teal", value: "#19E1CA", target: "root", format: "raw" },
  { key: "hl-yellow", value: "#FEC405", target: "root", format: "raw" },
  { key: "hl-pink", value: "#F168F5", target: "root", format: "raw" },

  { key: "warn-from", value: "#FF6A5E", target: "root", format: "raw" },
  { key: "warn-to", value: "#FF2E7E", target: "root", format: "raw" },
  { key: "success-from", value: "#4FD18B", target: "root", format: "raw" },
  { key: "success-to", value: "#2FA86A", target: "root", format: "raw" },

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
];

const UNIT_SUFFIX: Record<Format, string> = {
  raw: "",
  px: "px",
  rem: "rem",
  ms: "ms",
  percent: "%",
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
