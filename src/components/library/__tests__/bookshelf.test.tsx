import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Bookshelf } from "../bookshelf";
import { BookCard } from "../book-card";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

const coverBook = {
  id: "b1",
  title: "With Cover",
  author: "Auth",
  coverPath: "covers/b1.jpg",
  progress: null,
  hasProgress: false,
} as any;

describe("BookCard with cover", () => {
  it("respects the cover's natural aspect ratio (no forced 3:4 box, no crop)", () => {
    const html = render(<BookCard {...coverBook} />);
    // The user contract: "respect the actual aspect ratio." Enforced by
    // (a) dropping the 3:4 lock on the wrapper, and
    // (b) sizing the img to its natural ratio at full width instead of cropping.
    expect(html).not.toContain("aspect-[3/4]");
    expect(html).not.toContain("object-cover");
    expect(html).toMatch(/<img[^>]*\bh-auto\b/);
    expect(html).toMatch(/<img[^>]*\bw-full\b/);
  });
});

describe("Bookshelf", () => {
  it("aligns books to a shared bottom baseline", () => {
    // The user contract: "share a common baseline, much like books sitting
    // on a bookshelf." items-end is the mechanism that anchors row cells to
    // a common bottom edge so varying cover heights meet the same line.
    const html = render(<Bookshelf books={[coverBook]} />);
    expect(html).toContain("items-end");
  });
});
