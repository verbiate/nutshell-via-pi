import { describe, it, expect } from "vitest";
import {
  hrefBasename,
  parseCitations,
  isValidHref,
  segmentText,
  aggregateLinks,
  resolveToSpineHref,
} from "../citations";

describe("hrefBasename", () => {
  it("strips fragments, query, and path", () => {
    expect(hrefBasename("OEBPS/chapter1.xhtml#p4")).toBe("chapter1.xhtml");
    expect(hrefBasename("a/b/c.xhtml?x=1")).toBe("c.xhtml");
    expect(hrefBasename("c.xhtml")).toBe("c.xhtml");
  });
});

describe("parseCitations", () => {
  it("extracts #ch: markdown links in order", () => {
    const out = parseCitations("see [Chapter One](#ch:chapter1.xhtml) then [Two](#ch:c2.xhtml)");
    expect(out).toEqual([
      { label: "Chapter One", href: "chapter1.xhtml" },
      { label: "Two", href: "c2.xhtml" },
    ]);
  });

  it("ignores non-#ch: links and plain markdown", () => {
    expect(parseCitations("[real](https://example.com) and [x](#other)")).toEqual([]);
    expect(parseCitations("no links here")).toEqual([]);
  });

  it("handles empty text", () => {
    expect(parseCitations("")).toEqual([]);
  });
});

describe("isValidHref", () => {
  const spine = ["OEBPS/chapter1.xhtml", "chapter2.xhtml"];
  it("matches by basename", () => {
    expect(isValidHref("chapter1.xhtml", spine)).toBe(true);
    expect(isValidHref("OEBPS/chapter1.xhtml#frag", spine)).toBe(true);
  });
  it("rejects unknown hrefs", () => {
    expect(isValidHref("nope.xhtml", spine)).toBe(false);
    expect(isValidHref("", spine)).toBe(false);
  });
});

describe("segmentText", () => {
  it("splits text and links, preserving surrounding text", () => {
    const segs = segmentText("Before [Ch 1](#ch:c1.xhtml) after");
    expect(segs).toEqual([
      { type: "text", value: "Before " },
      { type: "link", label: "Ch 1", href: "c1.xhtml" },
      { type: "text", value: " after" },
    ]);
  });
  it("emits a single text segment when no citations", () => {
    expect(segmentText("plain text")).toEqual([{ type: "text", value: "plain text" }]);
  });
  it("does not segment non-#ch: links", () => {
    const segs = segmentText("[x](https://e.com)");
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("text");
  });
});

describe("aggregateLinks", () => {
  const spine = [
    { href: "c1.xhtml", index: 0 },
    { href: "c2.xhtml", index: 5 },
    { href: "c3.xhtml", index: 2 },
  ];
  it("dedupes by basename across messages and sorts by spine reading order", () => {
    const out = aggregateLinks(
      ["[A](#ch:c2.xhtml) [B](#ch:c3.xhtml)", "[dup](#ch:c2.xhtml)"],
      spine
    );
    // c3 (index 2) sorts before c2 (index 5); c2 deduped to a single entry.
    expect(out).toHaveLength(2);
    expect(out[0].href).toBe("c3.xhtml");
    expect(out[1].href).toBe("c2.xhtml");
  });
  it("drops hrefs not in the spine", () => {
    expect(aggregateLinks(["[x](#ch:ghost.xhtml)"], spine)).toEqual([]);
  });
  it("annotates spineIndex", () => {
    const out = aggregateLinks(["[x](#ch:c1.xhtml)"], spine);
    expect(out[0].spineIndex).toBe(0);
  });
});

describe("resolveToSpineHref", () => {
  // ponytail: the model emits bare basenames (buildChapterIndex emits basenames),
  // but rendition.display() needs a full spine href on prefixed-spine EPUBs.
  // spine.get only has a decodeURI fallback, no basename match — so citations
  // must be resolved to the full href at the navigation boundary.
  const spineHrefs = ["OEBPS/chapter1.xhtml", "OEBPS/chapter2.xhtml"];

  it("resolves a bare basename to the full prefixed spine href", () => {
    expect(resolveToSpineHref("chapter1.xhtml", spineHrefs)).toBe(
      "OEBPS/chapter1.xhtml"
    );
  });

  it("returns the input unchanged when it is already a full spine href", () => {
    expect(resolveToSpineHref("OEBPS/chapter2.xhtml", spineHrefs)).toBe(
      "OEBPS/chapter2.xhtml"
    );
  });

  it("returns the input unchanged when no spine href matches (graceful)", () => {
    expect(resolveToSpineHref("ghost.xhtml", spineHrefs)).toBe("ghost.xhtml");
  });

  it("returns empty input unchanged", () => {
    expect(resolveToSpineHref("", spineHrefs)).toBe("");
  });
});
