import { describe, it, expect } from "vitest";
import { isRestorableCfi } from "../epub-viewer";

// ponytail: the smallest check that fails if the degenerate-CFI guard breaks.
// The user saw `Failed to execute 'setEnd' on 'Range': There is no child at
// offset N` because a saved CFI of the form `epubcfi(/6/N!/:0)` was passed
// back to rendition.display() — epub.js resolves those to the section root
// Element, and its setEnd-fallback throws. isRestorableCfi filters them.

describe("isRestorableCfi", () => {
  it("accepts a typical element-path CFI with a char offset", () => {
    expect(isRestorableCfi("epubcfi(/6/14!/4/4/38[d1-d2s5d3s14]/34/1:719)")).toBe(true);
  });

  it("accepts an element-path CFI without a char offset", () => {
    expect(isRestorableCfi("epubcfi(/6/10!/4/4/4/2/1:0)")).toBe(true);
  });

  it("rejects the degenerate form emitted on initial section display (with offset)", () => {
    expect(isRestorableCfi("epubcfi(/6/14!/:0)")).toBe(false);
  });

  it("rejects the degenerate form without an offset", () => {
    expect(isRestorableCfi("epubcfi(/6/10!/)")).toBe(false);
  });

  it("rejects empty / null / undefined", () => {
    expect(isRestorableCfi("")).toBe(false);
    expect(isRestorableCfi(null)).toBe(false);
    expect(isRestorableCfi(undefined)).toBe(false);
  });
});
