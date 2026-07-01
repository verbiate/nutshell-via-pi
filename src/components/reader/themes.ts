export const READER_THEME_NAMES = ["light", "dark", "sepia"] as const;
export type ReaderThemeName = (typeof READER_THEME_NAMES)[number];

// ponytail: no font-family here — Serif (the default) and Sans are applied via
// the house stylesheet (see house-styles.ts); Publisher is the opt-in that omits
// it so the epub's own embedded font shows through.
export const READER_THEME_OVERRIDES: Record<string, string> = {
  "font-size": "clamp(16px, 1rem + 0.375vw, 20px)",
  "line-height": "1.5",
  "text-align": "justify",
  hyphens: "auto",
};

export const READER_THEMES = {
  light: {
    rules: {
      body: {
        background: "#FEFBF5",
        color: "#402A08",
      },
      ".tts-active": {
        "background-color": "rgba(212, 165, 95, 0.25)",
        "border-radius": "2px",
        "box-shadow": "0 0 0 2px rgba(212, 165, 95, 0.25)",
        transition: "background-color 220ms ease, box-shadow 220ms ease",
      },
      ".tts-chunk": {
        "background-color": "rgba(212, 165, 95, 0.4)",
        "border-radius": "2px",
        "box-shadow": "none",
        color: "inherit",
        transition: "background-color 220ms ease, box-shadow 220ms ease",
      },
    },
  },
  dark: {
    rules: {
      body: {
        background: "#1A130C",
        color: "#F2E9D4",
      },
      ".tts-active": {
        "background-color": "rgba(212, 165, 95, 0.3)",
        "border-radius": "2px",
        "box-shadow": "0 0 0 2px rgba(212, 165, 95, 0.3)",
        transition: "background-color 220ms ease, box-shadow 220ms ease",
      },
      ".tts-chunk": {
        "background-color": "rgba(212, 165, 95, 0.45)",
        "border-radius": "2px",
        "box-shadow": "none",
        color: "inherit",
        transition: "background-color 220ms ease, box-shadow 220ms ease",
      },
    },
  },
  sepia: {
    rules: {
      body: {
        background: "#f4ecd8",
        color: "#5b4636",
      },
      ".tts-active": {
        "background-color": "rgba(180, 130, 60, 0.2)",
        "border-radius": "2px",
        "box-shadow": "0 0 0 2px rgba(180, 130, 60, 0.2)",
        transition: "background-color 220ms ease, box-shadow 220ms ease",
      },
      ".tts-chunk": {
        "background-color": "rgba(180, 130, 60, 0.3)",
        "border-radius": "2px",
        "box-shadow": "none",
        color: "inherit",
        transition: "background-color 220ms ease, box-shadow 220ms ease",
      },
    },
  },
} as const;
