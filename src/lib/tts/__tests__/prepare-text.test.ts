import { describe, it, expect } from "vitest";
import { htmlToTtsText } from "../prepare-text";

describe("htmlToTtsText", () => {
  it("splits headings and paragraphs into separate lines", () => {
    const html = `<h1>6</h1><h1>Commit: The Nuna Story</h1><p>Jini Kim</p><p>Cofounder and CEO</p><p>Nuna is the story of...</p>`;
    expect(htmlToTtsText(html)).toBe(
      "6.\nCommit: The Nuna Story.\nJini Kim.\nCofounder and CEO.\nNuna is the story of...",
    );
  });

  it("adds a period to lines missing terminal punctuation", () => {
    const html = `<p>First line</p><p>Second line</p>`;
    expect(htmlToTtsText(html)).toBe("First line.\nSecond line.");
  });

  it("preserves existing sentence terminators", () => {
    const html = `<p>First.</p><p>Second?</p><p>Third!</p>`;
    expect(htmlToTtsText(html)).toBe("First.\nSecond?\nThird!");
  });

  it("replaces trailing clause punctuation with a period", () => {
    const html = `<p>Byline,</p><p>Role:</p><p>Location;</p><p>Date—</p>`;
    expect(htmlToTtsText(html)).toBe(
      "Byline.\nRole.\nLocation.\nDate.",
    );
  });

  it("keeps inline tags inside a line", () => {
    const html = `<p>This is <em>italic</em> and <strong>bold</strong> text.</p>`;
    expect(htmlToTtsText(html)).toBe("This is italic and bold text.");
  });

  it("decodes common entities and numeric entities", () => {
    const html = `<p>A&amp;B&nbsp;C&#8212;D</p>`;
    expect(htmlToTtsText(html)).toBe("A&B C—D.");
  });

  it("strips scripts and styles", () => {
    const html = `<style>body { color: red; }</style><script>alert(1);</script><p>Visible.</p>`;
    expect(htmlToTtsText(html)).toBe("Visible.");
  });

  it("collapses intra-line whitespace but preserves line breaks", () => {
    const html = `<p>Line    one</p><p>Line   two</p>`;
    expect(htmlToTtsText(html)).toBe("Line one.\nLine two.");
  });

  it("treats <br> as a line break", () => {
    const html = `<p>Line one<br>Line two</p>`;
    expect(htmlToTtsText(html)).toBe("Line one.\nLine two.");
  });

  it("filters out empty lines produced by structural markup", () => {
    const html = `<div></div><p>Real.</p><div></div>`;
    expect(htmlToTtsText(html)).toBe("Real.");
  });
});
