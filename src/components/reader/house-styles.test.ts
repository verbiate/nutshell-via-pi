import { describe, it, expect, beforeEach } from "vitest";
import {
  SERIF_STACK,
  SANS_STACK,
  HOUSE_STYLES,
  buildHouseStyleSheet,
  applyHouseStyleToDoc,
  buildPlexFontFaceCss,
  __resetFontFaceCacheForTests,
  type HouseStyleChoice,
} from "./house-styles";

beforeEach(() => __resetFontFaceCacheForTests());

describe("HOUSE_STYLES stacks", () => {
  it("serif targets IBM Plex Serif", () => {
    expect(SERIF_STACK.startsWith('"IBM Plex Serif"')).toBe(true);
    expect(HOUSE_STYLES.serif.stack).toBe(SERIF_STACK);
  });

  it("sans targets IBM Plex Sans (not DM Sans)", () => {
    expect(SANS_STACK.startsWith('"IBM Plex Sans"')).toBe(true);
    expect(SANS_STACK).not.toContain("DM Sans");
    expect(HOUSE_STYLES.sans.stack).toBe(SANS_STACK);
  });
});

describe("buildHouseStyleSheet", () => {
  it("returns null for publisher (no injection)", () => {
    expect(buildHouseStyleSheet("publisher")).toBeNull();
  });

  it.each(["serif", "sans"] as HouseStyleChoice[])(
    "%s resets body, headings, blockquotes, lists and first-letter",
    (choice) => {
      const css = buildHouseStyleSheet(choice);
      expect(css).not.toBeNull();
      // Structural elements the house style owns (per agreed v1 scope).
      for (const sel of ["body", "h1", "h2", "h3", "blockquote", "li"]) {
        expect(css).toContain(sel);
      }
      expect(css).toContain("::first-letter");
      // Reset must use !important to beat publisher stylesheet rules.
      expect(css).toContain("!important");
    },
  );

  it("serif stylesheet carries the serif stack, sans the sans stack", () => {
    expect(buildHouseStyleSheet("serif")).toContain(SERIF_STACK);
    expect(buildHouseStyleSheet("sans")).toContain(SANS_STACK);
  });
});

// Minimal stub of the bits of Document applyHouseStyleToDoc touches. Keeps the
// suite in the repo's default node test env (no jsdom dependency for one file).
type FakeStyle = { id: string; textContent: string; remove: () => void };
function freshDoc(): { byId: Map<string, FakeStyle> } & Record<string, unknown> {
  const byId = new Map<string, FakeStyle>();
  const doc = {
    byId,
    head: {
      appendChild: (el: FakeStyle) => {
        byId.set(el.id, el);
      },
    },
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: (_tag: string): FakeStyle => {
      const el = { id: "", textContent: "" } as FakeStyle;
      el.remove = () => {
        byId.delete(el.id);
      };
      return el;
    },
  };
  return doc as ReturnType<typeof freshDoc>;
}
function asDoc(doc: ReturnType<typeof freshDoc>) {
  return doc as unknown as Document;
}

describe("applyHouseStyleToDoc", () => {
  it("injects a single #br-house-style style for serif", () => {
    const doc = freshDoc();
    applyHouseStyleToDoc(asDoc(doc), "serif");
    expect(doc.byId.size).toBe(1);
    const el = doc.byId.get("br-house-style");
    expect(el?.textContent).toContain(SERIF_STACK);
  });

  it("replaces (not duplicates) on re-apply with a different style", () => {
    const doc = freshDoc();
    applyHouseStyleToDoc(asDoc(doc), "serif");
    applyHouseStyleToDoc(asDoc(doc), "sans");
    expect(doc.byId.size).toBe(1);
    const el = doc.byId.get("br-house-style");
    expect(el?.textContent).toContain(SANS_STACK);
    expect(el?.textContent).not.toContain(SERIF_STACK);
  });

  it("removes the style element when switching to publisher", () => {
    const doc = freshDoc();
    applyHouseStyleToDoc(asDoc(doc), "serif");
    expect(doc.byId.get("br-house-style")).toBeTruthy();
    applyHouseStyleToDoc(asDoc(doc), "publisher");
    expect(doc.byId.get("br-house-style")).toBeUndefined();
  });

  it("is a no-op on publisher when nothing was injected", () => {
    const doc = freshDoc();
    applyHouseStyleToDoc(asDoc(doc), "publisher");
    expect(doc.byId.size).toBe(0);
  });
});

describe("buildPlexFontFaceCss", () => {
  // ponytail: inject a stub document so the helper is testable in node. The
  // runtime caller omits sourceDoc and reads the real parent document.
  function docWith(sheets: { cssText: string }[][], hrefs: (string | null)[]) {
    return {
      baseURI: "https://app.example/",
      styleSheets: sheets.map((rules, i) => ({
        href: hrefs[i] ?? null,
        cssRules: rules,
      })),
    };
  }

  it("clones matching @font-face rules with url() rebased absolute", () => {
    const doc = docWith(
      [
        [
          {
            cssText:
              '@font-face { font-family: "IBM Plex Serif"; src: url("../media/abc.woff2") format("woff2"); }',
          },
          {
            cssText:
              '@font-face { font-family: "Other Font"; src: url("x.woff2"); }',
          },
        ],
      ],
      ["https://app.example/_next/static/chunks/font.css"],
    );
    const css = buildPlexFontFaceCss(["IBM Plex Serif"], doc);
    expect(css).toContain("IBM Plex Serif");
    // ../media resolved against the sheet href's directory → absolute
    expect(css).toContain("https://app.example/_next/static/media/abc.woff2");
    expect(css).not.toContain("Other Font");
  });

  it("returns empty when no matching family is present", () => {
    const doc = docWith(
      [[{ cssText: '@font-face { font-family: "DM Sans"; src: url("y.woff2"); }' }]],
      [null],
    );
    expect(buildPlexFontFaceCss(["IBM Plex Serif"], doc)).toBe("");
  });
});
