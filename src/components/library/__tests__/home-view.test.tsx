import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeView } from "../home-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

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

  it("keeps the last book row clear of the overlay with 12px bottom padding", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    expect(html).toContain("pb-3");
  });

  it("centers the search bar within the bookshelf scroll column at lg", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    // Bar now lives inside the scrollable book column; inner row just centers.
    const row = html.match(/class="([^"]*h-full items-center justify-center px-8[^"]*)"/)?.[1] ?? null;
    expect(row).not.toBeNull();
    // The old 2fr page-grid spacer must be gone.
    expect(html).not.toContain("lg:flex-[2]");
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

  it("keeps DailyDigest at fixed height while stretching only the tab-content column", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    // ponytail: grid must NOT stretch all items (that fills the digest card);
    // only the right-hand tab-content column opts in via self-stretch.
    expect(html).not.toContain("lg:items-stretch");
    expect(html).toContain("lg:self-stretch");
  });
});
