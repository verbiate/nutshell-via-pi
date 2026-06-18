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
        language="en"
        coverPath={null}
      />,
    );
    expect(html).toContain('href="/book/abc/reader"');
  });
});
