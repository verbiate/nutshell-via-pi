import { describe, it, expect } from "vitest";
import { buildChapterIndex } from "../prompt-builder";

describe("buildChapterIndex", () => {
  it("renders a link-form manifest of top-level ToC entries", () => {
    const toc = JSON.stringify([
      { label: "Chapter One", href: "chapter1.xhtml" },
      { label: "Chapter Two", href: "OEBPS/chapter2.xhtml" },
    ]);
    expect(buildChapterIndex(toc)).toBe(
      "- [Chapter One](#ch:chapter1.xhtml)\n- [Chapter Two](#ch:chapter2.xhtml)"
    );
  });

  it("reads `title` (the format this app actually stores), falling back from `label`", () => {
    // Real tocJson rows are flat {id, title, href, level} — no `label` field.
    // buildChapterIndex must read title or every book's manifest comes back empty.
    const toc = JSON.stringify([
      { id: "toc-0", title: "1. What Is It Like to Be a Bat?", href: "html/08_chapter1.xhtml#frag", level: 0 },
      { id: "toc-1", title: "2. Further Thoughts: The Psychophysical Nexus", href: "html/09_chapter2.xhtml#frag", level: 0 },
    ]);
    expect(buildChapterIndex(toc)).toBe(
      "- [1. What Is It Like to Be a Bat?](#ch:08_chapter1.xhtml)\n- [2. Further Thoughts: The Psychophysical Nexus](#ch:09_chapter2.xhtml)"
    );
  });

  it("ignores subitems (top-level only) and strips fragments", () => {
    const toc = JSON.stringify([
      { label: "Part One", href: "part1.xhtml#top", subitems: [{ label: "Ch A", href: "a.xhtml" }] },
    ]);
    expect(buildChapterIndex(toc)).toBe("- [Part One](#ch:part1.xhtml)");
  });

  it("skips entries missing label or href", () => {
    const toc = JSON.stringify([{ label: "Ok", href: "ok.xhtml" }, { label: "No href" }, { href: "x.xhtml" }]);
    expect(buildChapterIndex(toc)).toBe("- [Ok](#ch:ok.xhtml)");
  });

  it("caps the number of entries", () => {
    const toc = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ label: `C${i}`, href: `c${i}.xhtml` })));
    expect(buildChapterIndex(toc, 2)).toBe("- [C0](#ch:c0.xhtml)\n- [C1](#ch:c1.xhtml)");
  });

  it("sanitizes brackets in labels so they can't terminate the link early", () => {
    // CITE_RE in citations.ts captures [^\]]+ for the label; an unsanitized ]
    // in a title would silently break parsing. [ → ( and ] → ).
    const toc = JSON.stringify([{ label: "Appendix [Notes]", href: "app.xhtml" }]);
    expect(buildChapterIndex(toc)).toBe("- [Appendix (Notes)](#ch:app.xhtml)");
  });

  it("returns empty string for null / malformed JSON / non-array", () => {
    expect(buildChapterIndex(null)).toBe("");
    expect(buildChapterIndex("not json")).toBe("");
    expect(buildChapterIndex("{}")).toBe("");
    expect(buildChapterIndex("[]")).toBe("");
  });
});
