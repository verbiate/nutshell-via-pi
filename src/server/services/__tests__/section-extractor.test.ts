import { describe, it, expect } from "vitest";
import {
  extractElementByIdHtml,
  extractRangeFromIdHtml,
} from "../section-extractor";

describe("extractElementByIdHtml", () => {
  it("returns the inner HTML of the element with the matching id", () => {
    const html =
      '<body><div id="prev">x</div>' +
      '<p id="v3">Hello <em>world</em></p>' +
      '<p id="v4">next</p></body>';
    expect(extractElementByIdHtml(html, "v3")).toBe("Hello <em>world</em>");
  });

  it("tracks nested same-name tags without closing early", () => {
    const html =
      '<section id="ch1">' +
      "<section>inner</section>" +
      "tail" +
      "</section>" +
      "<section>after</section>";
    expect(extractElementByIdHtml(html, "ch1")).toBe(
      "<section>inner</section>tail",
    );
  });

  it("matches single-quoted id attributes", () => {
    const html = "<div><p id='verse-7'>text</p></div>";
    expect(extractElementByIdHtml(html, "verse-7")).toBe("text");
  });

  it("matches when id is not the first attribute", () => {
    const html = '<div><p class="verse" id="v7">text</p></div>';
    expect(extractElementByIdHtml(html, "v7")).toBe("text");
  });

  it("returns null when the id is absent (caller falls back to whole file)", () => {
    const html = "<div><p>nope</p></div>";
    expect(extractElementByIdHtml(html, "missing")).toBeNull();
  });

  it("handles self-closing matched element as empty inner", () => {
    const html = '<div><img id="i1" src="x.png"/></div>';
    expect(extractElementByIdHtml(html, "i1")).toBe("");
  });

  it("escapes regex-special ids", () => {
    const html = '<div><p id="v.1.2">dots</p></div>';
    expect(extractElementByIdHtml(html, "v.1.2")).toBe("dots");
  });

  it("falls back to rest-of-document when the element is never closed", () => {
    // ponytail: malformed input — return from after the open tag to EOF rather
    // than loop forever or throw.
    const html = '<div><p id="v1">open forever';
    expect(extractElementByIdHtml(html, "v1")).toBe("open forever");
  });
});

describe("extractRangeFromIdHtml", () => {
  // ponytail: TTS section text must span from one ToC anchor to the next,
  // not just the anchor's element. Otherwise verse-structured books read one
  // paragraph per section and force constant advancement.
  it("returns outer HTML from start anchor to next id'd element", () => {
    const html =
      '<body><div id="prev">x</div>' +
      '<p id="v3">Hello <em>world</em></p>' +
      "<p>middle of section</p>" +
      '<p id="v4">next section</p></body>';
    expect(extractRangeFromIdHtml(html, "v3")).toBe(
      '<p id="v3">Hello <em>world</em></p><p>middle of section</p>',
    );
  });

  it("reads to end of content when start anchor is the last id'd element", () => {
    const html =
      '<p id="last">final section</p><p>tail without anchor</p>';
    expect(extractRangeFromIdHtml(html, "last")).toBe(
      '<p id="last">final section</p><p>tail without anchor</p>',
    );
  });

  it("returns null when the start id is absent (caller falls back)", () => {
    expect(extractRangeFromIdHtml("<div>nothing</div>", "missing")).toBeNull();
  });

  it("returns just the start element when next sibling immediately has an id", () => {
    const html = '<p id="a">a</p><p id="b">b</p>';
    expect(extractRangeFromIdHtml(html, "a")).toBe('<p id="a">a</p>');
  });

  it("matches when id is not the first attribute", () => {
    const html =
      '<p class="verse" id="v7">text</p><p id="v8">next</p>';
    expect(extractRangeFromIdHtml(html, "v7")).toBe(
      '<p class="verse" id="v7">text</p>',
    );
  });

  // ponytail: regression — nested ids inside the start element's subtree
  // (footnote refs, pagebreak spans, figure anchors) must NOT end the range.
  // Without skipping the subtree, the range would truncate at the first nested
  // id and TTS text would be near-empty → no-op playback. Real EPUBs hit this
  // constantly (Calibre pagebreaks, Penguin footnotes).
  it("skips nested ids inside the start element's subtree", () => {
    const html =
      '<section id="chapter5">' +
      "<h1>Chapter 5</h1>" +
      '<p>Some text<a id="fn1">¹</a> more text.</p>' +
      '<p><span id="page_47"/></p>' +
      "<p>Second paragraph.</p>" +
      "</section>" +
      '<section id="chapter6">Next chapter</section>';
    expect(extractRangeFromIdHtml(html, "chapter5")).toBe(
      '<section id="chapter5">' +
        "<h1>Chapter 5</h1>" +
        '<p>Some text<a id="fn1">¹</a> more text.</p>' +
        '<p><span id="page_47"/></p>' +
        "<p>Second paragraph.</p>" +
        "</section>",
    );
  });

  it("reads to EOF when the start element has nested ids but no following anchor", () => {
    const html =
      '<section id="last">' +
      "<p>final <span id=\"p1\"/> section</p>" +
      "</section>";
    expect(extractRangeFromIdHtml(html, "last")).toBe(html);
  });

  it("handles self-closing start element (no subtree)", () => {
    // ponytail: self-closing start tag has no subtree — search forward from
    // right after the start tag.
    const html = '<img id="cover" src="x"/><p id="first">First</p>';
    expect(extractRangeFromIdHtml(html, "cover")).toBe(
      '<img id="cover" src="x"/>',
    );
  });
});
