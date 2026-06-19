import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  defaultParams,
  applyParam,
  type ParamValue,
} from "./tweakpane-params";

const expectedDefaults: Record<string, ParamValue> = {
  paper: "#FBF7EC",
  "paper-deep": "#F4EEDC",
  espresso: "#2B1C11",
  ink: "#33271B",
  line: "#E7DFCC",
  "line-soft": "#EFE9D8",
  lav: "#7E70EA",
  "lav-soft": "#ECE8FB",
  "lav-ring": "#C8C1F4",
  g1: "#FF7A4D",
  g2: "#FF4E8C",
  g3: "#C932A6",
  "b-orange": "#FF7A4D",
  "b-magenta": "#E541C9",
  "b-purple": "#8A6FE8",
  "b-blue": "#2EA6F0",
  "b-teal": "#3FD9B0",
  "hl-teal": "#19E1CA",
  "hl-yellow": "#FEC405",
  "hl-pink": "#F168F5",
  "warn-from": "#FF6A5E",
  "warn-to": "#FF2E7E",
  "success-from": "#4FD18B",
  "success-to": "#2FA86A",
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
    ["paper", "#ABCDEF"],
    ["g1", "#ABCDEF"],
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
