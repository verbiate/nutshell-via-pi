import { describe, it, expect } from "vitest";
import { extractElementByIdHtml } from "../section-extractor";

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
