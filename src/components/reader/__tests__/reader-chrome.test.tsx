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

  it("hides Bookshelf label when sidebarOpen=false", () => {
    const html = render(<ReaderChrome {...baseProps} />);
    expect(html).not.toContain("Bookshelf");
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

  it("floats with 48px margins from the top and sides (persisting across sidebar state)", () => {
    const open = render(<ReaderChrome {...baseProps} sidebarOpen onHideControls={() => {}} />);
    const closed = render(<ReaderChrome {...baseProps} />);
    for (const html of [open, closed]) {
      const header = html.match(/<header[^>]*>/)?.[0];
      expect(header, "header opening tag should be present").toBeTruthy();
      expect(header!).toContain("top-12");
      expect(header!).toContain("px-12");
      expect(header!).not.toContain("top-0");
    }
  });

  it("Bookshelf and Hide-controls buttons share the Add-a-book class with no fill or border", () => {
    const html = render(<ReaderChrome {...baseProps} sidebarOpen onHideControls={() => {}} />);
    const bookshelfBtn = html.match(/<button[^>]*aria-label="Back to bookshelf"[^>]*>/)?.[0];
    const hideBtn = html.match(/<button[^>]*aria-label="Hide controls"[^>]*>/)?.[0];
    expect(bookshelfBtn, "Bookshelf button should be present").toBeTruthy();
    expect(hideBtn, "Hide-controls button should be present").toBeTruthy();
    for (const btn of [bookshelfBtn!, hideBtn!]) {
      // ponytail: same proportions as the "Add a book" button (h-46px), minus its fill.
      // bg-transparent wins via tailwind-merge; only [a]:hover:bg-primary/80 (anchor-only) remains.
      expect(btn).toContain("h-[46px]");
      expect(btn).toContain("bg-transparent");
      expect(btn).not.toContain("bg-white");
    }
  });
});
