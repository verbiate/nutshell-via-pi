import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DesignSystemPage from "../page";

function render() {
  return renderToStaticMarkup(<DesignSystemPage />);
}

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
});
