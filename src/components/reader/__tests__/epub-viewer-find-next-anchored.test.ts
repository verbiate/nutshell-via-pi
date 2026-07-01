// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { findNextAnchoredElement } from "../epub-viewer";

// ponytail: regression test for the nested-id bug. EPUB section wrappers (e.g.
// <section id="chapter5">…</section>) almost always contain unrelated ids
// (footnote refs, pagebreak spans, figure anchors). The range finder must skip
// the start element's own subtree before searching for the next anchor, else
// the range truncates inside the start element and TTS gets near-empty text.

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("findNextAnchoredElement", () => {
  it("finds the next sibling anchor", () => {
    const d = doc(
      '<body><p id="a">A</p><p>middle</p><p id="b">B</p></body>',
    );
    const start = d.getElementById("a")!;
    expect(findNextAnchoredElement(d, start)?.id).toBe("b");
  });

  it("skips nested ids inside the start element's subtree", () => {
    const d = doc(
      '<body>' +
        '<section id="chapter5">' +
        "<h1>Chapter 5</h1>" +
        '<p>Some text<a id="fn1">¹</a> more text.</p>' +
        '<p><span id="page_47"/></p>' +
        "<p>Second paragraph.</p>" +
        "</section>" +
        '<section id="chapter6">Next chapter</section>' +
        "</body>",
    );
    const start = d.getElementById("chapter5")!;
    expect(findNextAnchoredElement(d, start)?.id).toBe("chapter6");
  });

  it("walks up through ancestors when the start element has no next sibling", () => {
    const d = doc(
      '<body><div><p id="only">only child</p></div><p id="after">after</p></body>',
    );
    const start = d.getElementById("only")!;
    expect(findNextAnchoredElement(d, start)?.id).toBe("after");
  });

  it("returns null when no anchored element follows the start subtree", () => {
    const d = doc(
      '<body><section id="last"><p id="nested">x</p></section></body>',
    );
    const start = d.getElementById("last")!;
    expect(findNextAnchoredElement(d, start)).toBeNull();
  });

  it("returns null when the start element IS doc.body (degenerate)", () => {
    const d = doc('<body><p id="x">x</p></body>');
    expect(findNextAnchoredElement(d, d.body)).toBeNull();
  });
});
