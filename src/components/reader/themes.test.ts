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

  it("light theme keeps the warm paper background", () => {
    expect(bodyRules("light").background).toBe("#FBF7EC");
    expect(bodyRules("light").color).toBe("#33271B");
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
  it("includes font-family, font-size, line-height, text-align, hyphens", () => {
    const keys = Object.keys(READER_THEME_OVERRIDES).sort();
    expect(keys).toEqual([
      "font-family",
      "font-size",
      "hyphens",
      "line-height",
      "text-align",
    ]);
  });

  it("uses IBM Plex Serif for body", () => {
    expect(READER_THEME_OVERRIDES["font-family"]).toMatch(/IBM Plex Serif/i);
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
