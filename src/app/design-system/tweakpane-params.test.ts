import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  defaultParams,
  applyParam,
  type ParamValue,
} from "./tweakpane-params";

const expectedDefaults: Record<string, ParamValue> = {
  tan: "#FEFBF5",
  "tan-dark": "#DDD8CD",
  chocolate: "#402A08",
  "chocolate-dark": "#221805",
  lav: "#A17FF0",
  "lav-soft": "#D9D6FF",
  "lav-ring": "#B8A8F5",
  peach: "#FE8050",
  pink: "#F168F5",
  purple: "#A17FF0",
  blue: "#18BDFD",
  teal: "#34E1CD",
  lavender: "#D9D6FF",
  "b-orange": "#FE8050",
  "b-magenta": "#F168F5",
  "b-purple": "#A17FF0",
  "b-blue": "#18BDFD",
  "b-teal": "#34E1CD",
  "hl-teal": "#34E1CD",
  "hl-yellow": "#FEC405",
  "hl-pink": "#F168F5",
  "warn-from": "#F9241E",
  "warn-to": "#F168F5",
  "success-from": "#18BDFD",
  "success-to": "#4FDB27",
  "r-sm": 10,
  "r-md": 16,
  "r-lg": 22,
  radius: 0.625,
  "reader-rail-w": 94,
  "reader-sidebar-w": 400,
  "reader-dur": 250,
  "book-hover-lift": 1,
  "tts-bar-h": 64,
  "tts-bar-blur": 6,
  "toolbar-w": 220,
  "toolbar-shadow-y": 8,
  "prose-font-size": 18,
  "prose-line-height": 1.5,
  "prose-max-width": 65,
  "prose-font-family": "var(--font-serif)",
  "prose-text-align": "left",
  "prose-hyphens": "manual",
  "prose-ligatures": "common-ligatures",
  "prose-numeric": "oldstyle-nums proportional-nums",
  "prose-optical": "auto",
};

interface DocStub {
  rootSet: ReturnType<typeof vi.fn>;
  gallerySet: ReturnType<typeof vi.fn>;
  querySelector: ReturnType<typeof vi.fn>;
}

function installDoc(opts: { galleryPresent: boolean }): DocStub {
  const rootSet = vi.fn();
  const gallerySet = vi.fn();
  const galleryEl = { style: { setProperty: gallerySet } };
  const querySelector = vi.fn((sel: string) =>
    sel === ".ds-gallery" && opts.galleryPresent ? galleryEl : null,
  );
  vi.stubGlobal("document", {
    documentElement: { style: { setProperty: rootSet } },
    querySelector,
  });
  return { rootSet, gallerySet, querySelector };
}

describe("defaultParams", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(defaultParams)).toBe(true);
  });

  it("contains every key with the exact default value", () => {
    expect({ ...defaultParams }).toEqual(expectedDefaults);
  });

  it("has exactly the expected set of keys (no extras, none missing)", () => {
    expect(new Set(Object.keys(defaultParams))).toEqual(
      new Set(Object.keys(expectedDefaults)),
    );
  });
});

describe("applyParam contract", () => {
  beforeEach(() => installDoc({ galleryPresent: true }));
  afterEach(() => vi.unstubAllGlobals());

  it("exposes a setter for every defaultParams key and nothing else", () => {
    expect(new Set(Object.keys(applyParam))).toEqual(
      new Set(Object.keys(defaultParams)),
    );
  });

  it.each([
    ["tan", "#ABCDEF"],
    ["peach", "#ABCDEF"],
    ["hl-teal", "#ABCDEF"],
    ["warn-from", "#ABCDEF"],
  ] as const)("color setter %s writes value as-is to :root", (key, value) => {
    const doc = installDoc({ galleryPresent: true });
    applyParam[key](value);
    expect(doc.rootSet).toHaveBeenCalledWith(`--${key}`, value);
  });

  it.each([
    ["r-md", 20, "20px"],
    ["r-sm", 8, "8px"],
    ["r-lg", 30, "30px"],
    ["radius", 0.5, "0.5rem"],
    ["reader-dur", 300, "300ms"],
    ["reader-rail-w", 100, "100px"],
    ["reader-sidebar-w", 380, "380px"],
  ] as const)("numeric root setter %s formats %s -> %s on :root", (key, value, formatted) => {
    const doc = installDoc({ galleryPresent: true });
    applyParam[key](value);
    expect(doc.rootSet).toHaveBeenCalledWith(`--${key}`, formatted);
  });

  it.each([
    ["book-hover-lift", 2, "2%"],
    ["tts-bar-h", 72, "72px"],
    ["tts-bar-blur", 10, "10px"],
    ["toolbar-w", 240, "240px"],
    ["toolbar-shadow-y", 12, "12px"],
  ] as const)("gallery setter %s formats %s -> %s on .ds-gallery", (key, value, formatted) => {
    const doc = installDoc({ galleryPresent: true });
    applyParam[key](value);
    expect(doc.gallerySet).toHaveBeenCalledWith(`--${key}`, formatted);
    expect(doc.rootSet).not.toHaveBeenCalledWith(`--${key}`, formatted);
  });

  it.each([
    ["prose-font-size", 20, "20px"],
    ["prose-max-width", 70, "70ch"],
    ["prose-line-height", 1.65, "1.65"],
  ] as const)("prose numeric setter %s formats %s -> %s on :root", (key, value, formatted) => {
    const doc = installDoc({ galleryPresent: true });
    applyParam[key](value);
    expect(doc.rootSet).toHaveBeenCalledWith(`--${key}`, formatted);
  });

  it.each([
    ["prose-font-family", "var(--font-sans)", "var(--font-sans)"],
    ["prose-text-align", "justify", "justify"],
    ["prose-hyphens", "auto", "auto"],
    ["prose-ligatures", "none", "none"],
    ["prose-numeric", "lining-nums tabular-nums", "lining-nums tabular-nums"],
    ["prose-optical", "none", "none"],
  ] as const)("prose string setter %s writes %s -> %s as-is on :root", (key, value, formatted) => {
    const doc = installDoc({ galleryPresent: true });
    applyParam[key](value);
    expect(doc.rootSet).toHaveBeenCalledWith(`--${key}`, formatted);
  });

  it("gallery setters target the .ds-gallery element via querySelector", () => {
    const doc = installDoc({ galleryPresent: true });
    applyParam["tts-bar-h"](64);
    expect(doc.querySelector).toHaveBeenCalledWith(".ds-gallery");
  });

  it("gallery setter is a silent no-op when .ds-gallery is absent", () => {
    const doc = installDoc({ galleryPresent: false });
    expect(() => applyParam["book-hover-lift"](3)).not.toThrow();
    expect(doc.gallerySet).not.toHaveBeenCalled();
  });

  it("a color key never writes to the gallery element", () => {
    const doc = installDoc({ galleryPresent: true });
    applyParam["lav"]("#FFFFFF");
    expect(doc.gallerySet).not.toHaveBeenCalled();
  });
});
