export const READER_THEME_NAMES = ["light", "dark", "sepia"] as const;
export type ReaderThemeName = (typeof READER_THEME_NAMES)[number];

export const READER_THEME_OVERRIDES: Record<string, string> = {
  "font-family": '"IBM Plex Serif", Georgia, "Times New Roman", serif',
  "font-size": "clamp(16px, 1rem + 0.375vw, 20px)",
  "line-height": "1.5",
  "text-align": "justify",
  hyphens: "auto",
};

export const READER_THEMES = {
  light: {
    rules: {
      body: {
        background: "#FBF7EC",
        color: "#33271B",
      },
    },
  },
  dark: {
    rules: {
      body: {
        background: "#1A130C",
        color: "#F2E9D4",
      },
    },
  },
  sepia: {
    rules: {
      body: {
        background: "#f4ecd8",
        color: "#5b4636",
      },
    },
  },
} as const;
