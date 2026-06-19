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
});
