import { describe, it, expect } from "vitest";
import { pinAnchor } from "@/server/services/book-metadata";

// ponytail: pinAnchor is a pure helper — smallest possible test covering the
// three meaningful cases: found, not-found (misquote), and end-anchor
// lastIndexOf semantics (closing snippet reused earlier in text).

describe("pinAnchor", () => {
  const text = "Title Page\n\nChapter 1\n\nThe quick brown fox.\n\nEnd.\n\nGlossary\n\nThe quick brown fox.";

  it("finds the first occurrence for a start anchor", () => {
    expect(pinAnchor("The quick brown fox.", text)).toBe(
      text.indexOf("The quick brown fox.")
    );
  });

  it("pins the LAST occurrence for an end anchor (phrase reused earlier)", () => {
    const last = text.lastIndexOf("The quick brown fox.");
    expect(pinAnchor("The quick brown fox.", text, true)).toBe(last);
    expect(last).toBeGreaterThan(text.indexOf("The quick brown fox."));
  });

  it("returns null for a misquoted anchor", () => {
    expect(pinAnchor("Thee quick brown fox.", text)).toBeNull();
  });

  it("returns null for null/empty anchor", () => {
    expect(pinAnchor(null, text)).toBeNull();
    expect(pinAnchor("", text)).toBeNull();
  });
});
