import { describe, it, expect } from "vitest";
import { buildChapterIndex } from "../prompt-builder";

describe("buildChapterIndex", () => {
  it("renders a numbered manifest of top-level ToC entries", () => {
    const toc = JSON.stringify([
      { label: "Chapter One", href: "chapter1.xhtml" },
      { label: "Chapter Two", href: "OEBPS/chapter2.xhtml" },
    ]);
    expect(buildChapterIndex(toc)).toBe(
      "[1] Chapter One → chapter1.xhtml\n[2] Chapter Two → chapter2.xhtml"
    );
  });

  it("ignores subitems (top-level only) and strips fragments", () => {
    const toc = JSON.stringify([
      { label: "Part One", href: "part1.xhtml#top", subitems: [{ label: "Ch A", href: "a.xhtml" }] },
    ]);
    expect(buildChapterIndex(toc)).toBe("[1] Part One → part1.xhtml");
  });

  it("skips entries missing label or href", () => {
    const toc = JSON.stringify([{ label: "Ok", href: "ok.xhtml" }, { label: "No href" }, { href: "x.xhtml" }]);
    expect(buildChapterIndex(toc)).toBe("[1] Ok → ok.xhtml");
  });

  it("caps the number of entries", () => {
    const toc = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ label: `C${i}`, href: `c${i}.xhtml` })));
    expect(buildChapterIndex(toc, 2)).toBe("[1] C0 → c0.xhtml\n[2] C1 → c1.xhtml");
  });

  it("returns empty string for null / malformed JSON / non-array", () => {
    expect(buildChapterIndex(null)).toBe("");
    expect(buildChapterIndex("not json")).toBe("");
    expect(buildChapterIndex("{}")).toBe("");
    expect(buildChapterIndex("[]")).toBe("");
  });
});
