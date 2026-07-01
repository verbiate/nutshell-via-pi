import { describe, it, expect } from "vitest";
import { READER_THEMES, READER_THEME_OVERRIDES } from "./themes";

type Rules = Record<string, Record<string, string>>;

function bodyRules(name: keyof typeof READER_THEMES): Rules["body"] {
  const theme = READER_THEMES[name] as unknown as { rules: Rules };
  return theme.rules.body;
}

describe("READER_THEMES", () => {
  it("exposes light, dark, and sepia themes", () => {
    expect(Object.keys(READER_THEMES).sort()).toEqual(["dark", "light", "sepia"]);
  });

  it.each(["light", "dark", "sepia"] as const)(
    "%s theme body rules contain only background and color",
    (name) => {
      const keys = Object.keys(bodyRules(name)).sort();
      expect(keys).toEqual(["background", "color"]);
    },
  );

  it("light theme uses a clean white background with chocolate ink", () => {
    expect(bodyRules("light").background).toBe("#FFFFFF");
    expect(bodyRules("light").color).toBe("#402A08");
  });

  it("sepia theme uses the brand tan background with chocolate ink", () => {
    expect(bodyRules("sepia").background).toBe("#FEFBF5");
    expect(bodyRules("sepia").color).toBe("#402A08");
  });

  it("dark theme uses the chocolate background with cream ink", () => {
    expect(bodyRules("dark").background).toBe("#402A08");
    expect(bodyRules("dark").color).toBe("#F2E9D4");
  });

  it.each(["light", "dark", "sepia"] as const)(
    "%s theme exposes valid hex background and color for forced overrides",
    (name) => {
      expect(bodyRules(name).background).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(bodyRules(name).color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    },
  );
});

describe("READER_THEME_OVERRIDES", () => {
  // ponytail: font-family is intentionally absent here — the default (Serif)
  // and Sans are applied via the house stylesheet injected by epub-viewer (see
  // house-styles.ts). Publisher is the opt-in that omits it, letting the epub's
  // own embedded font show through.
  it("omits font-family so the epub's own font wins by default", () => {
    expect(READER_THEME_OVERRIDES).not.toHaveProperty("font-family");
  });

  it("includes font-size, line-height, text-align, hyphens", () => {
    const keys = Object.keys(READER_THEME_OVERRIDES).sort();
    expect(keys).toEqual(["font-size", "hyphens", "line-height", "text-align"]);
  });

  it("justifies body text with hyphenation", () => {
    expect(READER_THEME_OVERRIDES["text-align"]).toBe("justify");
    expect(READER_THEME_OVERRIDES.hyphens).toBe("auto");
  });

  it("sets a comfortable leading", () => {
    expect(READER_THEME_OVERRIDES["line-height"]).toBe("1.5");
  });

  it("all override values are strings (compatible with themes.override)", () => {
    for (const [key, val] of Object.entries(READER_THEME_OVERRIDES)) {
      expect(typeof val).toBe("string");
    }
  });
});
