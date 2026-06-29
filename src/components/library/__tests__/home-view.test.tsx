import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
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

vi.mock("@/components/transitions/scene-transition", () => ({
  useSceneTransition: () => ({ suppressShelfReveal: false }),
}));

function render(el: ReactElement) {
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>{el}</QueryClientProvider>,
  );
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
    expect(html).toContain("Discussions");
    expect(html).toContain("Find more books");
  });

  it("applies type-header to the greeting (Figma-locked typography token)", () => {
    const html = render(
      <HomeView userName="Mary" books={[]} digestImage={null} />,
    );
    // ponytail: header typography is driven by the type-header @utility, which
    // consumes the --type-header-* tokens. Drift from the Figma spec
    // (34px/500/leading-tight) is closed.
    expect(html).toContain("type-header");
    expect(html).not.toContain("font-serif text-[34px] font-medium");
  });

  it("renders the bookshelf search bar", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    expect(html).toContain('placeholder="Ask your books…"');
    expect(html).toContain("Ask your books");
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
    // ponytail: 3 from the TabsContent elements + 1 from the bookshelf's
    // SmoothScrollArea wrapper (className="lg:absolute lg:inset-0"). The
    // SmoothScrollArea wrapper renders in SSR now that the mobile/reduced-
    // motion branch emits a scroll div (previously a fragment passthrough).
    // The 4th occurrence is nested inside the bookshelf TabsContent and
    // fills it — it doesn't create an extra scroll region, just positions
    // the SmoothScrollArea viewport inside the already-bounded TabsContent.
    for (const cls of ["lg:absolute", "lg:inset-0"]) {
      const count = (html.match(new RegExp(cls, "g")) || []).length;
      expect(count).toBe(4);
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

  it("fixes the DailyDigest column at 480px and lets the bookshelf flex", () => {
    const html = render(
      <HomeView userName="Mary" books={books} digestImage={null} />,
    );
    expect(html).toContain("lg:grid-cols-[480px_1fr]");
    expect(html).not.toContain("lg:grid-cols-[2fr_3fr]");
  });
});
