import { describe, it, expect } from "vitest";
import { resolveThumbnailNav } from "../tts-player";

// ponytail: the thumbnail branching is a pure fn so it gets its own check with
// no DOM/router. goToBook's side effects (sync, markPending, router/navigate)
// map 1:1 onto these branches — see tts-player.tsx.

describe("resolveThumbnailNav", () => {
  const bookId = "abc-123";

  it("returns same-book-on-reader when already on that book's reader route", () => {
    expect(resolveThumbnailNav(`/book/${bookId}/reader`, bookId)).toBe(
      "same-book-on-reader",
    );
  });

  it("returns other-reader when on a different book's reader route", () => {
    expect(resolveThumbnailNav("/book/other-456/reader", bookId)).toBe(
      "other-reader",
    );
  });

  it("returns scene-nav from the library/shelf", () => {
    expect(resolveThumbnailNav("/my-library", bookId)).toBe("scene-nav");
  });

  it("returns scene-nav from the profile route", () => {
    expect(resolveThumbnailNav("/profile", bookId)).toBe("scene-nav");
  });

  it("returns scene-nav when pathname is null (first render / unknown)", () => {
    expect(resolveThumbnailNav(null, bookId)).toBe("scene-nav");
  });

  it("does NOT match a book id that is a string prefix of the route's book id", () => {
    // ponytail: /book/abc-123-extra/reader must not match bookId "abc-123".
    expect(resolveThumbnailNav("/book/abc-123-extra/reader", "abc-123")).toBe(
      "other-reader",
    );
  });
});
