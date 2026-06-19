import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeView } from "../home-view";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

const books = [
  { id: "b1", title: "A Book", author: "Auth", coverPath: null, progress: null },
] as any;

describe("HomeView", () => {
  it("renders the three shelf tab labels", () => {
    const html = render(
      <HomeView userName="Mary" books={[]} digestImage={null} />,
    );
    expect(html).toContain("Bookshelf");
    expect(html).toContain("Explainers");
    expect(html).toContain("Find more books");
  });

  it("renders the bookshelf search bar", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    expect(html).toContain('placeholder="Search or ask your books…"');
    expect(html).toContain("Search books");
  });

  it("anchors the search region to a 138px progressively-blurred bottom bar", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    expect(html).toContain("h-[138px]");
    expect(html).toContain("backdrop-filter:blur(");
    expect(html).toContain("linear-gradient(to top,");
    expect(html).toContain("fixed");
    expect(html).toContain("bottom-0");
  });

  it("keeps the last book row clear of the overlay with 138px bottom padding", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    expect(html).toContain("pb-[138px]");
  });

  it("mirrors the page grid gap so the bar centers exactly over the book column", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    const row = html.match(/class="([^"]*max-w-\[1280px\][^"]*)"/)?.[1] ?? null;
    expect(row).not.toBeNull();
    expect(row!).toContain("gap-6");
  });
});
