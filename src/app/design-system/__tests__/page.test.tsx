import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import DesignSystemPage from "../page";

function render() {
  return renderToStaticMarkup(<DesignSystemPage />);
}

const PAGE_SRC = readFileSync(
  fileURLToPath(new URL("../page.tsx", import.meta.url)),
  "utf8",
);

describe("Design system page", () => {
  it("renders the page heading", () => {
    const html = render();
    expect(html).toContain("A reading surface with a quiet voice");
  });

  describe("Foundations — extended tokens", () => {
    it("shows the three highlight color hexes used by the highlighter", () => {
      const html = render();
      expect(html).toContain("#34E1CD"); // teal
      expect(html).toContain("#FEC405"); // yellow
      expect(html).toContain("#F168F5"); // pink
    });

    it("shows the new brand color swatches with their hexes", () => {
      const html = render();
      expect(html).toContain("#FE8050"); // peach
      expect(html).toContain("#F168F5"); // pink
      expect(html).toContain("#A17FF0"); // purple
      expect(html).toContain("#18BDFD"); // blue
      expect(html).toContain("#34E1CD"); // teal
      expect(html).toContain("#D9D6FF"); // lavender
      expect(html).toContain("#F9241E"); // red-warn
      expect(html).toContain("#4FDB27"); // green-success
    });

    it("shows the Tan/Chocolate surface swatches", () => {
      const html = render();
      expect(html).toContain("#FEFBF5"); // tan
      expect(html).toContain("#DDD8CD"); // tan-dark
      expect(html).toContain("#402A08"); // chocolate
      expect(html).toContain("#221805"); // chocolate-dark
    });

    it("shows the warn and success status gradient pills", () => {
      const html = render();
      expect(html).toContain("Warn");
      expect(html).toContain("Success");
    });

    it("shows the five OKLCH gradient utilities", () => {
      const html = render();
      expect(html).toContain("bg-grad-peach-pink");
      expect(html).toContain("bg-grad-purple-tan");
      expect(html).toContain("bg-grad-teal-blue");
      expect(html).toContain("bg-grad-warn");
      expect(html).toContain("bg-grad-success");
    });

    it("shows the four radii tokens with their px values", () => {
      const html = render();
      expect(html).toContain("10px"); // --r-sm
      expect(html).toContain("16px"); // --r-md
      expect(html).toContain("22px"); // --r-lg
      expect(html).toContain("999px"); // --r-pill
    });

    it("shows the reader geometry tokens with their values", () => {
      const html = render();
      expect(html).toContain("94px");   // --reader-rail-w
      expect(html).toContain("400px");  // --reader-sidebar-w
      expect(html).toContain("250ms");  // --reader-dur
    });

    it("consumes highlighter tokens via var() so Tweakpane can dial them", () => {
      const html = render();
      expect(html).toContain("var(--hl-teal)");
      expect(html).toContain("var(--hl-yellow)");
      expect(html).toContain("var(--hl-pink)");
    });

    it("renders highlighter swatches at 50% alpha with multiply blend", () => {
      const html = render();
      // React SSR serializes inline styles as prop:value (no spaces).
      expect(html).toContain("mix-blend-mode:multiply");
      expect(html).toContain("opacity:0.5");
    });
  });

  describe("Section 02 — Typography", () => {
    it("renders the Typography section heading", () => {
      expect(render()).toContain("Typography");
    });

    it("renders the three UI role specimens via their type-* utility classes", () => {
      const html = render();
      // Header specimen (Good morning, Reader) driven by type-header
      expect(html).toContain("type-header");
      expect(html).toContain("Good morning, Reader");
      // Button specimen renders an actual Button with type-button baked in
      expect(html).toContain("type-button");
      expect(html).toContain("Add a book");
      // Tab specimen renders three TabsTriggers with type-tab baked in
      expect(html).toContain("type-tab");
      expect(html).toContain("Bookshelf");
    });

    it("shows the Figma-locked token summaries under each specimen", () => {
      const html = render();
      expect(html).toContain("Plex Serif · 400 · 30px · 1.07 · ls −0.005em");
      expect(html).toContain("DM Sans · 600 · 15px · 1.35");
      expect(html).toContain("DM Sans · 600 · 12px · 1.35 · ls −0.025em");
    });

    it("renders the dialable prose sample wrapped in .ds-prose", () => {
      const html = render();
      expect(html).toContain("ds-prose");
      // Real prose with curly quotes and a 0 (exercises oldstyle figures)
      expect(html).toContain("0th of October");
      expect(html).toContain("five-and-seventy");
    });

    it("retrofits the intro paragraph to consume .ds-prose instead of fixed sizing", () => {
      const html = render();
      // The intro paragraph must drop text-[15.5px] and max-w-[60ch] in favor
      // of the dialable vars; .ds-prose wraps it and color stays via text-ink/80.
      expect(html).toContain("ds-prose mt-3 text-ink/80");
      expect(html).not.toContain("max-w-[60ch]");
      expect(html).not.toContain("text-[15.5px]");
    });
  });

  describe("Gallery scoped wrapper and layout vars", () => {
    it("mounts the .ds-gallery wrapper as the setter target", () => {
      expect(render()).toContain("ds-gallery");
    });

    it("emits the book-hover-lift scoped var in the inline style block", () => {
      expect(render()).toContain("var(--book-hover-lift");
    });

    it("lifts only the cover wrapper, not the whole card, on hover", () => {
      const html = render();
      expect(html).toContain(".ds-book-card:hover .ds-book-lift");
    });

    it("renders the TTS player mirror as a floating card", () => {
      const html = render();
      expect(html).toContain("max-w-[320px]");
      expect(html).toContain('aria-label="Audio player (demo mirror)"');
    });

    it("consumes var(--toolbar-w) on the FloatingToolbar mirror", () => {
      expect(render()).toContain("var(--toolbar-w");
    });
  });

  describe("Section 07 — Library", () => {
    it("renders the Library section heading", () => {
      expect(render()).toContain("Library");
    });

    it("renders three BookCards in the shelf, including the placeholder and the demo cover", () => {
      const html = render();
      // Placeholder card shows the title text on the gradient
      expect(html).toContain("The Rustic Drawer");
      // Demo cover card links to its book and renders the cover image
      expect(html).toContain("/demo-cover.svg");
      expect(html).toContain("/book/demo-1/reader");
      expect(html).toContain("/book/demo-2/reader");
    });

    it("renders the daily digest headline from the real DailyDigest component", () => {
      const html = render();
      expect(html).toContain("Your daily digest, ready when you are.");
    });

    it("renders the empty-state pattern headline", () => {
      const html = render();
      expect(html).toContain("Your library is empty");
    });
  });

  describe("Section 08 — Reader chrome", () => {
    it("renders the ReaderChrome Bookshelf back button inside the frame", () => {
      const html = render();
      expect(html).toContain("Reader chrome"); // section-07-specific
      expect(html).toContain("Bookshelf");
    });

    it("renders the ReadingProgress region with role=progressbar", () => {
      const html = render();
      expect(html).toContain("Reader chrome"); // section-07-specific
      expect(html).toContain('role="progressbar"');
    });

    it("renders the initial 38% progress label", () => {
      const html = render();
      expect(html).toContain("Reader chrome"); // section-07-specific
      expect(html).toContain("38%");
    });

    it("renders the TTS player mirror with the Play icon, section label, and settings button", () => {
      const html = render();
      expect(html).toContain("Section 1 · The Beginning");
      expect(html).toContain('aria-label="Play"');
      expect(html).toContain('aria-label="Audio settings"');
    });
  });

  describe("Section 09 — Reader sidebar", () => {
    it("renders all five rail tool buttons with their aria-labels", () => {
      const html = render();
      expect(html).toContain("Reader sidebar"); // section-08-specific
      expect(html).toContain('aria-label="Contents"');
      expect(html).toContain('aria-label="Bookmarks"');
      expect(html).toContain('aria-label="Notes + Highlights"');
      expect(html).toContain('aria-label="Discussions"');
      expect(html).toContain('aria-label="Book Settings"');
    });

    it("defaults to showing the Contents panel header", () => {
      const html = render();
      expect(html).toContain("Reader sidebar"); // section-08-specific
      expect(html).toContain("Sample TOC");
    });

    it("renders the BookSettingsPanel inside the settings tool panel", () => {
      const html = render();
      expect(html).toContain("Reader sidebar"); // section-08-specific — "Book Settings" alone overlaps with section 04
      expect(html).toContain("Book Settings");
      expect(html).toContain("Page Adjustments");
      expect(html).toContain("Open audio settings");
    });
  });

  describe("Section 10 — Selection & settings", () => {
    it("renders the FloatingToolbar mirror with Ask and Copy actions", () => {
      const html = render();
      expect(html).toContain("Selection &amp; settings"); // section-09 anchor (React escapes & in HTML)
      expect(html).toContain("Ask about this");
      expect(html).toContain("Copy");
      expect(html).toContain("Create a note:");
    });

    it("renders the three highlight swatches in the floating toolbar", () => {
      const html = render();
      expect(html).toContain("Selection &amp; settings"); // section-09 anchor (React escapes & in HTML)
      expect(html).toContain("#34E1CD");
      expect(html).toContain("#FEC405");
      expect(html).toContain("#F168F5");
    });

    it("renders a sample paragraph with the highlighted phrase", () => {
      const html = render();
      expect(html).toContain("Selection &amp; settings"); // section-09 anchor (React escapes & in HTML)
      expect(html).toContain("It was the best of times");
    });

    it("retrofits the reading paragraph to .ds-prose (drops font-serif/leading-relaxed)", () => {
      const html = render();
      expect(html).toContain("Selection &amp; settings");
      // The Dickens sample now drives vars via .ds-prose; color via text-ink.
      expect(html).toContain("ds-prose text-ink");
      expect(html).not.toContain("font-serif text-base leading-relaxed text-ink");
    });

    it("leaves §09 FloatingToolbar highlight swatches as literal hex", () => {
      const html = render();
      expect(html).toContain("Selection &amp; settings"); // section-09 anchor (React escapes & in HTML)
      expect(html).toContain("#34E1CD");
      expect(html).toContain("#FEC405");
      expect(html).toContain("#F168F5");
    });
  });

  describe("Task 4 — Tweakpane panel wiring", () => {
    // The Tweakpane mount is imperative CDN-loaded DOM code and is not
    // SSR-testable. We assert the wiring exists in the page source: the
    // params import, the Pane constructor, the binding helper, and the
    // Copy/Paste buttons. Behavioral verification is manual.
    it("imports defaultParams and applyParam from ./tweakpane-params", () => {
      expect(PAGE_SRC).toContain('from "./tweakpane-params"');
    });

    it("constructs a Tweakpane Pane", () => {
      expect(PAGE_SRC).toContain("new Pane(");
    });

    it("uses the addBindingWithReset helper", () => {
      expect(PAGE_SRC).toContain("addBindingWithReset");
    });

    it("wires a Copy Parameters button", () => {
      expect(PAGE_SRC).toContain("Copy Parameters");
    });

    it("wires a Paste Parameters button", () => {
      expect(PAGE_SRC).toContain("Paste Parameters");
    });

    // ponytail: regression guard. Turbopack intercepts dynamic import() of a
    // CDN URL (the /* @vite-ignore */ pragma is Vite-only, meaningless to
    // Turbopack) and crashes at runtime with __turbopack_context__.x is not
    // a function. The fix is to inject a <script type="module"> element at
    // runtime so the bundler never sees the URL string.
    it("does not load Tweakpane via intercepted dynamic import()", () => {
      expect(PAGE_SRC).not.toContain("await import(");
    });

    it("loads Tweakpane via injected <script type=\"module\">", () => {
      expect(PAGE_SRC).toContain('createElement("script")');
    });
  });
});
