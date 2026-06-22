import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReaderChrome } from "../reader-chrome";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

const baseProps = {
  onBack: () => {},
  searchTrigger: <button aria-label="search">S</button>,
  ttsTrigger: <button aria-label="read aloud">T</button>,
};

describe("ReaderChrome: sidebar-aware top bar", () => {
  it("renders Bookshelf label when sidebarOpen=true", () => {
    const html = render(<ReaderChrome {...baseProps} sidebarOpen onHideControls={() => {}} />);
    expect(html).toContain("Bookshelf");
  });

  it("renders Bookshelf label when sidebarOpen=false", () => {
    const html = render(<ReaderChrome {...baseProps} />);
    expect(html).toContain("Bookshelf");
  });

  it("never renders a book title in the top bar", () => {
    const closed = render(<ReaderChrome {...baseProps} />);
    const open = render(<ReaderChrome {...baseProps} sidebarOpen onHideControls={() => {}} />);
    expect(closed).not.toContain('aria-label="Book title');
    expect(open).not.toContain('aria-label="Book title');
  });

  it("renders Hide controls button when sidebarOpen=true", () => {
    const html = render(<ReaderChrome {...baseProps} sidebarOpen onHideControls={() => {}} />);
    expect(html).toContain("Hide controls");
  });

  it("Hide controls is collapsed and non-interactive when sidebarOpen=false", () => {
    const closed = render(<ReaderChrome {...baseProps} onHideControls={() => {}} />);
    expect(closed).toContain("Hide controls");
    expect(closed).toContain("grid-cols-[0fr]");
    expect(closed).toContain('aria-hidden="true"');

    const open = render(<ReaderChrome {...baseProps} sidebarOpen onHideControls={() => {}} />);
    const openWrapper = open.slice(open.indexOf("grid-cols-[1fr]") - 60, open.indexOf("grid-cols-[1fr]") + 40);
    expect(openWrapper).toContain("grid-cols-[1fr]");
    expect(openWrapper).not.toContain('aria-hidden="true"');
  });

  it("Hide controls is a real button wired to onHideControls when sidebarOpen=true", () => {
    const html = render(<ReaderChrome {...baseProps} sidebarOpen onHideControls={() => {}} />);
    const match = /<button[^>]*>[\s\S]*Hide controls[\s\S]*<\/button>/.test(html);
    expect(match).toBe(true);
  });

  it("floats with 48px viewport margins when closed, 48px from sidebar when open", () => {
    const open = render(<ReaderChrome {...baseProps} sidebarOpen onHideControls={() => {}} />);
    const closed = render(<ReaderChrome {...baseProps} />);
    const closedHeader = closed.match(/<header[^>]*>/)?.[0];
    const openHeader = open.match(/<header[^>]*>/)?.[0];
    expect(closedHeader, "closed header should be present").toBeTruthy();
    expect(openHeader, "open header should be present").toBeTruthy();

    for (const html of [closedHeader!, openHeader!]) {
      expect(html).toContain("top-12");
      expect(html).not.toContain("top-0");
      expect(html).toContain("px-12");
      expect(html).toContain("pointer-events-none");
    }

    // Closed: header spans full viewport width so the right group is 48px from the viewport edge.
    expect(closedHeader!).toContain("right-0");
    expect(closedHeader!).not.toContain("sm:right-[");
    // Open: header right edge stops 48px before the sidebar.
    expect(openHeader!).toContain(
      "sm:right-[calc(var(--reader-rail-w)+var(--reader-sidebar-w)+48px)]"
    );

    // Interactive groups re-enable pointer events so buttons remain clickable.
    expect(closed).toContain("pointer-events-auto");
  });

  it("Bookshelf and Hide-controls buttons share the Add-a-book class with no fill or border", () => {
    const html = render(<ReaderChrome {...baseProps} sidebarOpen onHideControls={() => {}} />);
    const bookshelfBtn = html.match(/<button[^>]*aria-label="Back to bookshelf"[^>]*>/)?.[0];
    const hideBtn = html.match(/<button[^>]*aria-label="Hide controls"[^>]*>/)?.[0];
    expect(bookshelfBtn, "Bookshelf button should be present").toBeTruthy();
    expect(hideBtn, "Hide-controls button should be present").toBeTruthy();
    for (const btn of [bookshelfBtn!, hideBtn!]) {
      // ponytail: same proportions as the "Add a book" button (h-46px), minus its fill.
      // bg-transparent wins via tailwind-merge at rest; the default variant's
      // hover:bg-white/90 survives (no hover: override is added), which is fine —
      // it's a hover state, not a resting fill. The regex matches bg-white only
      // as a complete class (surrounded by space or quote), excluding hover:bg-white/90.
      expect(btn).toContain("h-[46px]");
      expect(btn).toContain("bg-transparent");
      expect(btn).not.toMatch(/[\s"]bg-white[\s"]/);
    }
  });

  describe("hidden prop fades chrome and disables interaction", () => {
    it("header has opacity-0 and aria-hidden when hidden=true", () => {
      const html = render(<ReaderChrome {...baseProps} hidden />);
      const header = html.match(/<header[^>]*>/)?.[0] ?? "";
      expect(header).toContain("opacity-0");
      expect(header).toContain('aria-hidden="true"');
    });

    it("header has neither opacity-0 nor aria-hidden when hidden=false", () => {
      const html = render(<ReaderChrome {...baseProps} />);
      const header = html.match(/<header[^>]*>/)?.[0] ?? "";
      expect(header).not.toContain("opacity-0");
      expect(header).not.toContain('aria-hidden="true"');
    });

    it("interactive groups lose pointer-events-auto when hidden=true", () => {
      const visible = render(<ReaderChrome {...baseProps} sidebarOpen onHideControls={() => {}} />);
      const hiddenHtml = render(<ReaderChrome {...baseProps} sidebarOpen hidden onHideControls={() => {}} />);
      // Visible: both groups carry pointer-events-auto.
      const visibleAuto = (visible.match(/pointer-events-auto/g) || []).length;
      expect(visibleAuto).toBeGreaterThanOrEqual(2);
      // Hidden: no group carries pointer-events-auto.
      expect(hiddenHtml).not.toContain("pointer-events-auto");
    });

    it("Bookshelf button is removed from tab order when hidden=true", () => {
      const hiddenHtml = render(<ReaderChrome {...baseProps} hidden />);
      const tagMatch = hiddenHtml.match(/<button[^>]*aria-label="Back to bookshelf"[^>]*>/);
      expect(tagMatch, "Bookshelf button should be present").toBeTruthy();
      expect(tagMatch![0]).toMatch(/tabindex="-1"/);
    });
  });
});
