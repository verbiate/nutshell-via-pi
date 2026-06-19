import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BookCard } from "../book-card";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

describe("BookCard", () => {
  it("links directly to the reader route", () => {
    const html = render(
      <BookCard
        id="abc"
        title="Some Book"
        author={null}
        coverPath={null}
      />,
    );
    expect(html).toContain('href="/book/abc/reader"');
  });

  it("renders the title on the placeholder cover when there is no cover image", () => {
    const html = render(
      <BookCard id="abc" title="Some Book" author={null} coverPath={null} />,
    );
    expect(html).toContain("Some Book");
  });

  it("reserves a progress slot so covers share a common baseline", () => {
    const without = render(
      <BookCard id="abc" title="T" author={null} coverPath={null} />,
    );
    const withProgress = render(
      <BookCard
        id="abc"
        title="T"
        author={null}
        coverPath={null}
        progress={42}
        hasProgress
      />,
    );
    expect(without).toContain("h-1.5");
    expect(withProgress).toContain("42");
    expect(withProgress).toContain("progressbar");
  });

  it("hides the progress bar when hasProgress is false even with a value", () => {
    const html = render(
      <BookCard
        id="abc"
        title="T"
        author={null}
        coverPath={null}
        progress={42}
        hasProgress={false}
      />,
    );
    expect(html).not.toContain("progressbar");
  });
});
