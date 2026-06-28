import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Bookshelf, BookshelfSkeleton } from "../bookshelf";
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

  it("uses the wider bookshelf padding and cell minimum (150px, px-6)", () => {
    const html = render(<Bookshelf books={[coverBook]} />);
    const expected =
      "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] items-end gap-x-5 gap-y-6 px-6";
    const old =
      "grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] items-end gap-x-5 gap-y-6 px-5";
    expect(html).toContain(expected);
    expect(html).not.toContain(old);
  });
});

describe("Bookshelf scroll-reveal hook", () => {
  it("renders a data-book-card marker on each book for ScrollTrigger batching", () => {
    const books = [
      { ...coverBook, id: "b1" },
      { ...coverBook, id: "b2", title: "Two" },
      { ...coverBook, id: "b3", title: "Three" },
    ];
    const html = render(<Bookshelf books={books} />);
    const count = (html.match(/data-book-card/g) || []).length;
    expect(count).toBe(3);
  });
});

describe("BookshelfSkeleton", () => {
  it("uses the wider bookshelf padding and cell minimum (150px, px-6)", () => {
    const html = render(<BookshelfSkeleton />);
    const expected =
      "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] items-end gap-x-5 gap-y-6 px-6";
    const old =
      "grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] items-end gap-x-5 gap-y-6 px-5";
    expect(html).toContain(expected);
    expect(html).not.toContain(old);
  });
});
