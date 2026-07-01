// ponytail: house styles are runtime CSS injected into the epub.js iframe via a
// content hook (sibling of the TTS-highlight / image-blend hooks). Serif/Sans
// fully reset body, headings, blockquotes, lists and first-letter so the book
// gets a consistent Nutshell typography regardless of publisher CSS. Publisher
// = no injection (book's own CSS wins), handled by the caller omitting the hook.
//
// Font loading: next/font keeps the literal family name "IBM Plex Serif"/"IBM
// Plex Sans" in its @font-face (verified against .next built CSS), but those
// @font-face rules live in the PARENT document only — the iframe does not
// inherit them. buildPlexFontFaceCss() clones the parent's @font-face into the
// iframe with url()s rebased absolute, so Plex actually resolves in the iframe.
// Without this, Serif/Sans silently fall back to Georgia / system-ui.

export type HouseStyleChoice = "serif" | "sans" | "publisher";
export type HouseStyleId = Exclude<HouseStyleChoice, "publisher">;

export const SERIF_STACK = '"IBM Plex Serif", Georgia, "Times New Roman", serif';
export const SANS_STACK = '"IBM Plex Sans", system-ui, -apple-system, sans-serif';

const STYLE_ELEMENT_ID = "br-house-style";

/**
 * Dynamic typography (font-size, line-height, text-align, hyphens) applied by
 * the reader. Must target body, p, li, dd, blockquote directly — NOT just body.
 *
 * ponytail: epub.js's themes.override() sets these as an inline style on <body>
 * only (Contents.css → body.style.setProperty). text-align / font-size set on
 * body reach <p> purely by inheritance, so any publisher rule like `p { text-align:
 * left }` (or the UA default) beats them — which is why the justify/left switch
 * appeared dead. Injecting on the structural elements with late !important wins.
 */
export interface ReaderTypography {
  fontSize: string; // e.g. "18px"
  lineHeight: string; // e.g. "1.5"
  textAlign: "left" | "justify";
  hyphens: "auto" | "manual";
}

export function typographyCss(t: ReaderTypography): string {
  return `body, p, li, dd, blockquote {
  font-size: ${t.fontSize} !important;
  line-height: ${t.lineHeight} !important;
  text-align: ${t.textAlign} !important;
  hyphens: ${t.hyphens} !important;
}`;
}

// The reset stylesheet for a given stack. Plain selectors + !important so it
// beats publisher stylesheet rules (same specificity, but important wins).
// ponytail: the one residual this CAN'T beat is a publisher's own inline
// style="font-family:..." — that needs a <link>/<style>-strip pass, deferred
// until a library book is shown to need it. Reset targets the structural
// elements only; poetry/tables/images fall through to the publisher.
// ponytail: ::first-letter is a raised cap (no float) because float drop-caps
// collide with epub.js paginated columns; upgrade to a float drop-cap only if a
// non-paginated layout is in play.
function resetCss(stack: string): string {
  return [
    `body, p, li, dd, blockquote { font-family: ${stack} !important; }`,
    // ponytail: force every structural text element to inherit the theme body
    // color (chocolate/cream/sepia, set on <body> via themes.override). Some
    // books set color: directly on p/h1/etc., breaking the monochrome look;
    // !important + late injection (after the book's CSS) wins. Body itself is
    // excluded — it carries the theme color. Inline <span style="color"> is the
    // same residual category as inline font-family; strip pass deferred.
    `p, li, dd, blockquote { color: inherit !important; }`,
    `h1, h2, h3, h4, h5, h6 {
       font-family: ${stack} !important;
       font-weight: 600 !important;
       line-height: 1.2 !important;
       text-indent: 0 !important;
       text-align: left !important;
       color: inherit !important;
     }`,
    `h1 { font-size: 1.75em !important; margin: 2em 0 0.67em !important; }`,
    `h2 { font-size: 1.45em !important; margin: 1.8em 0 0.6em !important; }`,
    `h3 { font-size: 1.25em !important; margin: 1.5em 0 0.5em !important; }`,
    `h4, h5, h6 { font-size: 1.1em !important; margin: 1.3em 0 0.5em !important; }`,
    `p {
       margin: 0 0 1em !important;
       text-indent: 0 !important;
     }`,
    `p:first-child,
     p:first-of-type { margin-top: 0 !important; }`,
    `blockquote {
       margin: 1.2em 1.5em !important;
       font-style: italic !important;
       color: inherit !important;
     }`,
    `ul, ol { margin: 0 0 1em 1.5em !important; padding-left: 0 !important; }`,
    `li { margin: 0 !important; }`,
    `p:first-of-type::first-letter {
       font-size: 1.25em !important;
       font-weight: 600 !important;
     }`,
  ].join("\n");
}

export const HOUSE_STYLES: Record<HouseStyleId, { stack: string }> = {
  serif: { stack: SERIF_STACK },
  sans: { stack: SANS_STACK },
};

// ponytail: memoize the font-face clone — families don't change at runtime and
// walking parent stylesheets on every section render is wasted work.
const fontFaceCache = new Map<string, string>();

// Test-only: the memo keys by family list, which breaks test isolation. Not
// exported from the package index; only house-styles.test imports it.
export function __resetFontFaceCacheForTests(): void {
  fontFaceCache.clear();
}

/**
 * Clone the given document's @font-face rules for the named Plex families into
 * a CSS string, with any relative url() rebased absolute against the owning
 * stylesheet's href so they resolve inside the iframe. Defaults to the global
 * `document` (the parent, at runtime); tests pass a stub. Returns "" on the
 * server or if no matching rules are found (caller's stack fallback then
 * applies).
 *
 * ponytail: sourceDoc is an injectable param purely so this is unit-testable
 * without jsdom — the runtime caller (buildHouseStyleSheet) omits it and reads
 * the real parent document's self-hosted @font-face.
 */
export function buildPlexFontFaceCss(
  families: string[],
  sourceDoc?: { styleSheets: Iterable<{ cssRules: Iterable<{ cssText: string }>; href: string | null }>; baseURI: string },
): string {
  const doc =
    sourceDoc ??
    (typeof document !== "undefined" ? document : null);
  if (!doc) return "";
  const key = families.join(",");
  const cached = fontFaceCache.get(key);
  if (cached !== undefined) return cached;

  const wanted = families.map((f) => f.toLowerCase());
  const out: string[] = [];

  for (const sheet of Array.from(doc.styleSheets as unknown as Iterable<{ cssRules: Iterable<{ cssText: string }>; href: string | null }>)) {
    let rules: { cssText: string }[];
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      continue; // cross-origin stylesheet without CORS
    }
    const base = sheet.href ?? doc.baseURI;
    for (const rule of rules) {
      const text = rule.cssText;
      // ponytail: duck-type on cssText (not instanceof CSSFontFaceRule) so the
      // rebase also works under jsdom / partial CSSOMs and is trivially testable.
      if (!text || !/@font-face/i.test(text)) continue;
      const fam = (
        text.match(/font-family\s*:\s*([^;}]+)/i)?.[1] ?? ""
      )
        .trim()
        .toLowerCase();
      if (!wanted.some((w) => fam === w || fam.includes(w))) continue;
      // Rebase every url() in the rule (only src carries urls in @font-face).
      const rebased = text.replace(
        /url\((['"]?)([^'")]+)\1\)/g,
        (_m, q: string, u: string) => {
          try {
            return `url(${q}${new URL(u, base).href}${q})`;
          } catch {
            return _m;
          }
        },
      );
      out.push(rebased);
    }
  }

  const result = out.join("\n");
  fontFaceCache.set(key, result);
  return result;
}

/**
 * Build the full injected stylesheet for a house style (font-face + reset).
 * Returns null for "publisher" (no injection).
 */
export function buildHouseStyleSheet(choice: HouseStyleChoice): string | null {
  if (choice === "publisher") return null;
  const { stack } = HOUSE_STYLES[choice];
  // ponytail: both Plex families cloned always — a serif book may still hit a
  // sans glyph and vice versa, and the clone is memoized + tiny.
  const fontFace = buildPlexFontFaceCss(["IBM Plex Serif", "IBM Plex Sans"]);
  return `${fontFace}\n${resetCss(stack)}`;
}

/**
 * Build the full reader stylesheet injected into an epub.js iframe: the house
 * reset + cloned @font-face (Serif/Sans only) PLUS the dynamic typography
 * (always — applies in Publisher too, so the size/leading/alignment controls
 * actually reach <p>). Returns a non-empty string.
 */
export function buildReaderStylesheet(
  choice: HouseStyleChoice,
  t: ReaderTypography,
): string {
  const parts: string[] = [];
  if (choice !== "publisher") {
    parts.push(buildPlexFontFaceCss(["IBM Plex Serif", "IBM Plex Sans"]));
    parts.push(resetCss(HOUSE_STYLES[choice].stack));
  }
  parts.push(typographyCss(t));
  return parts.join("\n");
}

/**
 * Idempotently apply (or replace) the reader stylesheet in an epub.js iframe
 * document. Removes any prior `<style id>` then inserts the current one. Safe
 * to call on every section render and on live house-style / typography switches.
 */
export function applyReaderStylesToDoc(
  doc: Document | undefined | null,
  choice: HouseStyleChoice,
  t: ReaderTypography,
): void {
  if (!doc || !doc.head) return;
  const css = buildReaderStylesheet(choice, t);
  const existing = doc.getElementById(STYLE_ELEMENT_ID);
  if (existing) {
    existing.textContent = css;
  } else {
    const el = doc.createElement("style");
    el.id = STYLE_ELEMENT_ID;
    el.textContent = css;
    doc.head.appendChild(el);
  }
}
