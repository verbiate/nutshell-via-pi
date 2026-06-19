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

// ponytail: SSR string checks are a structural proxy for "only tab content scrolls at lg".
// Real scroll behavior is verified manually in the browser; these guard the flex chain.
describe("HomeView scroll containment (lg+)", () => {
  it("makes the Tabs root fill remaining height so a flex chain can form below", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    expect(html).toContain("lg:flex-1");
    expect(html).toContain("lg:min-h-0");
  });

  it("pins the greeting + tabs row so it does not scroll away", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    expect(html).toContain("shrink-0");
  });

  it("bounds the digest/content grid so columns receive a fixed height", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    expect(html).toContain("lg:grid-rows-1");
    expect(html).toContain("lg:items-stretch");
    expect(html).toContain("lg:flex-1");
  });

  it("turns the tab-content column into the bounded scroll box", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    expect(html).toContain("lg:relative");
    expect(html).toContain("lg:overflow-hidden");
  });

  it("makes each of the three TabsContent the sole scroll region at lg", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    // ponytail: count must be 3 — one per TabsContent (bookshelf/explainers/find).
    // Unanchored toContain would pass with the class on only one of the three.
    for (const cls of ["lg:absolute", "lg:inset-0", "lg:overflow-y-auto"]) {
      const count = (html.match(new RegExp(cls, "g")) || []).length;
      expect(count).toBe(3);
    }
  });

  it("anchors the search bar to the scroll container at lg while staying fixed on mobile", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    expect(html).toContain("lg:sticky");
    expect(html).toContain("fixed");
    expect(html).toContain("bottom-0");
  });
});
