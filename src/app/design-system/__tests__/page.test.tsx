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
      expect(html).toContain("#19E1CA"); // teal
      expect(html).toContain("#FEC405"); // yellow
      expect(html).toContain("#F168F5"); // pink
    });

    it("shows the three gradient stops as labelled swatches", () => {
      const html = render();
      expect(html).toContain("#FF7A4D"); // g1
      expect(html).toContain("#FF4E8C"); // g2
      expect(html).toContain("#C932A6"); // g3
    });

    it("shows the warn and success status gradient pills", () => {
      const html = render();
      expect(html).toContain("Warn");
      expect(html).toContain("Success");
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

    it("consumes gradient-stop tokens via var()", () => {
      const html = render();
      expect(html).toContain("var(--g1)");
      expect(html).toContain("var(--g2)");
      expect(html).toContain("var(--g3)");
    });

    it("consumes status-gradient stop vars in the pills", () => {
      const html = render();
      expect(html).toContain("var(--warn-from)");
      expect(html).toContain("var(--success-from)");
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

    it("consumes var(--tts-bar-h) on the TTS bar mirror", () => {
      expect(render()).toContain("var(--tts-bar-h");
    });

    it("consumes var(--toolbar-w) on the FloatingToolbar mirror", () => {
      expect(render()).toContain("var(--toolbar-w");
    });
  });

  describe("Section 06 — Library", () => {
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

  describe("Section 07 — Reader chrome", () => {
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

    it("renders the TTS player mirror with the Play icon and a section label", () => {
      const html = render();
      expect(html).toContain("Section 1 · The Beginning");
      expect(html).toContain('aria-label="Play"');
    });
  });

  describe("Section 08 — Reader sidebar", () => {
    it("renders all five rail tool buttons with their aria-labels", () => {
      const html = render();
      expect(html).toContain("Reader sidebar"); // section-08-specific
      expect(html).toContain('aria-label="Contents"');
      expect(html).toContain('aria-label="Bookmarks"');
      expect(html).toContain('aria-label="Notes + Highlights"');
      expect(html).toContain('aria-label="Explainers"');
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
      expect(html).toContain("Voice Adjustments");
    });
  });

  describe("Section 09 — Selection & settings", () => {
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
      expect(html).toContain("#19E1CA");
      expect(html).toContain("#FEC405");
      expect(html).toContain("#F168F5");
    });

    it("renders a sample paragraph with the highlighted phrase", () => {
      const html = render();
      expect(html).toContain("Selection &amp; settings"); // section-09 anchor (React escapes & in HTML)
      expect(html).toContain("It was the best of times");
    });

    it("leaves §09 FloatingToolbar highlight swatches as literal hex", () => {
      const html = render();
      expect(html).toContain("Selection &amp; settings"); // section-09 anchor (React escapes & in HTML)
      expect(html).toContain("#19E1CA");
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
