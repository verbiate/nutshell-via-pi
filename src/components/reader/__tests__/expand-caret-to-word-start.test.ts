import { describe, it, expect, vi } from "vitest";
import {
  expandCaretToWordStart,
  expandCaretToWordEnd,
  wordRangeFromPoint,
} from "../epub-viewer";

function textNode(value: string) {
  return { nodeType: 3, nodeValue: value } as unknown as Node;
}

function elementNode() {
  return { nodeType: 1, nodeValue: null } as unknown as Node;
}

function createFakeRange(startContainer: Node, startOffset: number) {
  const self: {
    startContainer: Node | null;
    startOffset: number;
    endContainer: Node | null;
    endOffset: number;
    setStart(node: Node, offset: number): void;
    setEnd(node: Node, offset: number): void;
  } = {
    startContainer,
    startOffset,
    endContainer: null,
    endOffset: 0,
    setStart(node, offset) {
      self.startContainer = node;
      self.startOffset = offset;
    },
    setEnd(node, offset) {
      self.endContainer = node;
      self.endOffset = offset;
    },
  };
  return self as unknown as Range;
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

describe("expandCaretToWordEnd", () => {
  it("snaps a mid-word caret forward to the word end", () => {
    const node = textNode("smart");
    expect(expandCaretToWordEnd(node, 2).offset).toBe(5); // "mar" of "smart"
  });

  it("leaves a caret already at a word boundary unchanged", () => {
    const node = textNode("hello world");
    expect(expandCaretToWordEnd(node, 5).offset).toBe(5); // end of "hello"
  });

  it("clamps an offset past the end of the text", () => {
    const node = textNode("hi");
    expect(expandCaretToWordEnd(node, 10).offset).toBe(2);
  });

  it("returns offsets on non-text nodes unchanged", () => {
    const node = elementNode();
    expect(expandCaretToWordEnd(node, 4).offset).toBe(4);
  });

  it("handles unicode letters", () => {
    const node = textNode("café");
    expect(expandCaretToWordEnd(node, 1).offset).toBe(4);
  });
});

describe("wordRangeFromPoint", () => {
  function makeDoc(node: Node, offset: number) {
    const inputRange = createFakeRange(node, offset);
    const outputRange = createFakeRange(node, 0);
    return {
      doc: {
        createRange: vi.fn(() => outputRange),
        caretRangeFromPoint: vi.fn(() => inputRange),
        caretPositionFromPoint: undefined,
      } as unknown as Document,
      outputRange,
    };
  }

  it("returns null when the point is not over a text node", () => {
    const node = elementNode();
    const { doc } = makeDoc(node, 0);
    expect(wordRangeFromPoint(doc, 0, 0)).toBeNull();
  });

  it("returns null when the point is over whitespace or punctuation", () => {
    const node = textNode("   ");
    const { doc } = makeDoc(node, 1);
    expect(wordRangeFromPoint(doc, 0, 0)).toBeNull();
  });

  it("selects the full word under the point", () => {
    const node = textNode("hello world");
    const { doc, outputRange } = makeDoc(node, 8); // inside "world"
    const range = wordRangeFromPoint(doc, 0, 0);
    expect(range).toBe(outputRange);
    expect(outputRange.startOffset).toBe(6);
    expect(outputRange.endOffset).toBe(11);
  });

  it("falls back to caretPositionFromPoint when caretRangeFromPoint is unavailable", () => {
    const node = textNode("hello world");
    const pos = { offsetNode: node, offset: 8 };
    const outputRange = createFakeRange(node, 0);
    const doc = {
      createRange: vi.fn(() => outputRange),
      caretRangeFromPoint: undefined,
      caretPositionFromPoint: vi.fn(() => pos),
    } as unknown as Document;
    const range = wordRangeFromPoint(doc, 0, 0);
    expect(range).toBe(outputRange);
    expect(outputRange.startOffset).toBe(6);
    expect(outputRange.endOffset).toBe(11);
  });
});
