import { describe, it, expect } from "vitest";
import { expandCaretToWordStart } from "../epub-viewer";

function textNode(value: string) {
  return { nodeType: 3, nodeValue: value } as unknown as Node;
}

function elementNode() {
  return { nodeType: 1, nodeValue: null } as unknown as Node;
}

describe("expandCaretToWordStart", () => {
  it("snaps a mid-word caret back to the word start", () => {
    const node = textNode("smart");
    expect(expandCaretToWordStart(node, 3).offset).toBe(0); // "art" of "smart"
  });

  it("leaves a caret already at a word boundary unchanged", () => {
    const node = textNode("hello world");
    expect(expandCaretToWordStart(node, 6).offset).toBe(6); // start of "world"
  });

  it("clamps an offset past the end of the text", () => {
    const node = textNode("hi");
    expect(expandCaretToWordStart(node, 10).offset).toBe(0);
  });

  it("returns offsets on non-text nodes unchanged", () => {
    const node = elementNode();
    expect(expandCaretToWordStart(node, 4).offset).toBe(4);
  });

  it("handles unicode letters", () => {
    const node = textNode("café");
    expect(expandCaretToWordStart(node, 3).offset).toBe(0);
  });
});
