import { describe, it, expect, beforeEach } from "vitest";
import {
  SERIF_STACK,
  SANS_STACK,
  HOUSE_STYLES,
  buildHouseStyleSheet,
  buildReaderStylesheet,
  typographyCss,
  applyReaderStylesToDoc,
  buildPlexFontFaceCss,
  __resetFontFaceCacheForTests,
  type HouseStyleChoice,
  type ReaderTypography,
} from "./house-styles";

beforeEach(() => __resetFontFaceCacheForTests());

const JUSTIFY: ReaderTypography = {
  fontSize: "18px",
  lineHeight: "1.5",
  textAlign: "justify",
  hyphens: "auto",
};
const LEFT: ReaderTypography = { ...JUSTIFY, textAlign: "left", hyphens: "manual" };

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

describe("buildHouseStyleSheet (static house reset)", () => {
  it("returns null for publisher (no house reset)", () => {
    expect(buildHouseStyleSheet("publisher")).toBeNull();
  });

  it.each(["serif", "sans"] as HouseStyleChoice[])(
    "%s resets body, headings, blockquotes, lists and first-letter",
    (choice) => {
      const css = buildHouseStyleSheet(choice);
      expect(css).not.toBeNull();
      for (const sel of ["body", "h1", "h2", "h3", "blockquote", "li"]) {
        expect(css).toContain(sel);
      }
      expect(css).toContain("::first-letter");
      expect(css).toContain("!important");
      // Monochrome: structural text elements inherit the theme body color.
      expect(css).toContain("color: inherit !important");
      // Headings stay left-aligned (don't inherit a justified body).
      expect(css).toContain("text-align: left !important");
    },
  );
});

describe("typographyCss / buildReaderStylesheet", () => {
  it("targets body AND p (and li/dd/blockquote), not just body", () => {
    const css = typographyCss(JUSTIFY);
    // The bug: themes.override set text-align on <body> only, so publisher
    // `p { text-align }` beat it. The fix requires p in the selector list.
    expect(css).toMatch(/body, p, li, dd, blockquote/);
    expect(css).toContain("text-align: justify !important");
  });

  it("justified typography lands in the serif reader stylesheet", () => {
    const css = buildReaderStylesheet("serif", JUSTIFY);
    expect(css).toContain(SERIF_STACK);
    expect(css).toContain("text-align: justify !important");
    expect(css).toContain("hyphens: auto !important");
  });

  it("left alignment produces left + manual hyphens", () => {
    const css = buildReaderStylesheet("sans", LEFT);
    expect(css).toContain("text-align: left !important");
    expect(css).toContain("hyphens: manual !important");
  });

  it("publisher still injects typography (no house reset, no font stack)", () => {
    const css = buildReaderStylesheet("publisher", JUSTIFY);
    expect(css).toContain("text-align: justify !important");
    expect(css).not.toContain(SERIF_STACK);
    expect(css).not.toContain(SANS_STACK);
    expect(css).not.toContain("::first-letter");
  });
});

// Minimal stub of the bits of Document applyReaderStylesToDoc touches. Keeps the
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

describe("applyReaderStylesToDoc", () => {
  it("injects a single #br-house-style style for serif + typography", () => {
    const doc = freshDoc();
    applyReaderStylesToDoc(asDoc(doc), "serif", JUSTIFY);
    expect(doc.byId.size).toBe(1);
    const el = doc.byId.get("br-house-style");
    expect(el?.textContent).toContain(SERIF_STACK);
    expect(el?.textContent).toContain("text-align: justify !important");
  });

  it("replaces (not duplicates) on re-apply", () => {
    const doc = freshDoc();
    applyReaderStylesToDoc(asDoc(doc), "serif", JUSTIFY);
    applyReaderStylesToDoc(asDoc(doc), "sans", LEFT);
    expect(doc.byId.size).toBe(1);
    const el = doc.byId.get("br-house-style");
    expect(el?.textContent).toContain(SANS_STACK);
    expect(el?.textContent).toContain("text-align: left !important");
    expect(el?.textContent).not.toContain(SERIF_STACK);
  });

  it("publisher keeps the style element (typography still applies)", () => {
    const doc = freshDoc();
    applyReaderStylesToDoc(asDoc(doc), "serif", JUSTIFY);
    applyReaderStylesToDoc(asDoc(doc), "publisher", JUSTIFY);
    const el = doc.byId.get("br-house-style");
    expect(el).toBeTruthy();
    expect(el?.textContent).toContain("text-align: justify !important");
    expect(el?.textContent).not.toContain(SERIF_STACK);
  });

  it("a live alignment switch updates the same element", () => {
    const doc = freshDoc();
    applyReaderStylesToDoc(asDoc(doc), "serif", JUSTIFY);
    applyReaderStylesToDoc(asDoc(doc), "serif", LEFT);
    expect(doc.byId.size).toBe(1);
    const el = doc.byId.get("br-house-style");
    expect(el?.textContent).toContain("text-align: left !important");
    expect(el?.textContent).not.toContain("text-align: justify !important");
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
