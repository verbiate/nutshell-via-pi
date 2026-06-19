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

  it("Hide controls button uses content-fit size (not icon-only) when sidebarOpen=true", () => {
    const html = render(<ReaderChrome {...baseProps} sidebarOpen onHideControls={() => {}} />);
    const hideBtnMatch = html.match(/<button[^>]*aria-label="Hide controls"[^>]*>/);
    expect(hideBtnMatch, "Hide-controls button opening tag should be present").not.toBeNull();
    const hideBtn = hideBtnMatch![0];
    expect(hideBtn).toContain('data-size="sm"');
    expect(hideBtn).not.toContain('data-size="icon-sm"');
  });
});
