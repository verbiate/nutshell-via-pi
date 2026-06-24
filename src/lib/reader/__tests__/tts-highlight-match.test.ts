// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { htmlToTtsText } from "@/lib/tts/prepare-text";
import {
  pickTtsTargetIndex,
  findChunkRange,
  buildTextMap,
  wrapMark,
  unwrapMarks,
  wrapRangePerBlock,
} from "../tts-highlight-match";

describe("pickTtsTargetIndex", () => {
  it("matches the body paragraph when a chunk spans a heading + paragraph", () => {
    // Reproduces the live failure from the reader logs: "Chapter Four."
    // (period added by htmlToTtsText to the heading) chunked together with
    // the opening paragraph. The old single leading needle matched no block.
    const html =
      "<h1>Chapter Four</h1>" +
      "<p>The feeding of the nine billion: farmers must produce more food in the next fifty years than in the last ten thousand.</p>";
    const tts = htmlToTtsText(html).replace(/\n/g, " ");
    expect(tts.startsWith("Chapter Four. The feeding")).toBe(true);
    const chunk = tts.slice(0, 120);
    const blocks = ["Chapter Four", "The feeding of the nine billion: farmers must produce more food in the next fifty years than in the last ten thousand."];
    expect(pickTtsTargetIndex(chunk, blocks)).toBe(1);
  });

  it("matches the paragraph a mid-section chunk starts inside", () => {
    const para1 =
      "Farmers must produce more food in the next fifty years than in the last ten thousand.";
    const para2 =
      "They will do so through exchange, specialization, and the relentless innovation of ordinary people.";
    const chunk = "They will do so through exchange, specialization, and the relentless";
    expect(pickTtsTargetIndex(chunk, [para1, para2])).toBe(1);
  });

  it("matches a chunk that begins inside a long heading", () => {
    const heading = "The Introduction and Scope of This Volume";
    const para = "We begin with the deep origins of trade and trust.";
    const chunk = "The Introduction and Scope of This Volume";
    expect(pickTtsTargetIndex(chunk, [heading, para])).toBe(0);
  });

  it("returns -1 when no block contains any probe needle", () => {
    expect(pickTtsTargetIndex("zzz qqq xxx yyy", ["Completely unrelated text"])).toBe(-1);
  });
});

describe("findChunkRange", () => {
  it("locates a chunk that begins mid-paragraph", () => {
    const block =
      "Farmers must produce more food in the next fifty years than in the last ten thousand.";
    const chunk = "produce more food in the next fifty years";
    const r = findChunkRange(chunk, block);
    expect(r).not.toBeNull();
    expect(block.slice(r!.start, r!.end).startsWith("produce more food")).toBe(true);
  });

  it("clamps the end to the block when a chunk runs past it", () => {
    const block = "Short block of text right here continuing on.";
    const chunk = "Short block of text right here continuing on past the block end into more";
    const r = findChunkRange(chunk, block);
    expect(r).not.toBeNull();
    expect(r!.start).toBe(0);
    expect(r!.end).toBe(block.length);
  });

  it("returns null when no overlap exists", () => {
    expect(findChunkRange("zzz qqq xxx yyy zzz", "Completely unrelated text here")).toBeNull();
  });

  it("anchors the end to trailing text so added periods don't overshoot", () => {
    // Simulates htmlToTtsText adding a period ("Chapter Six." vs DOM "Chapter Six")
    // which inflates the chunk's length by 1. The char-count end would bleed
    // into the following word "And"; the trailing needle must end at "today."
    // (full-stop included) without touching "And".
    const block = "Chapter Six The production of Toy Story could begin today. And more.";
    const chunk = "Chapter Six. The production of Toy Story could begin today.";
    const r = findChunkRange(chunk, block);
    expect(r).not.toBeNull();
    expect(block.slice(r!.start, r!.end)).not.toContain("And");
    expect(block.slice(r!.start, r!.end).endsWith("today.")).toBe(true);
  });
});

describe("span wrapping (happy-dom)", () => {
  it("wraps the chunk text across an inline <em> and unwraps cleanly", () => {
    const p = document.createElement("p");
    p.innerHTML = "The quick <em>brown</em> fox jumps over the lazy dog.";
    document.body.appendChild(p);

    const map = buildTextMap(document, p);
    expect(map.text).toBe("The quick brown fox jumps over the lazy dog.");

    const r = findChunkRange("quick brown fox jumps", map.text);
    expect(r).not.toBeNull();

    const mark = wrapMark(document, map, r!.start, r!.end);
    expect(mark).not.toBeNull();
    expect(p.querySelector("mark.tts-chunk")).not.toBeNull();
    expect(mark!.textContent).toBe("quick brown fox jumps");
    // the <em> survives inside the mark
    expect(mark!.querySelector("em")).not.toBeNull();

    unwrapMarks(document);
    expect(p.querySelector("mark.tts-chunk")).toBeNull();
    expect(p.textContent).toBe("The quick brown fox jumps over the lazy dog.");
  });

  it("falls back to null (block-level) when the map is empty", () => {
    const p = document.createElement("p");
    p.innerHTML = "";
    document.body.appendChild(p);
    expect(wrapMark(document, buildTextMap(document, p), 0, 5)).toBeNull();
  });
});

describe("multi-block chunk wrapping (happy-dom)", () => {
  it("marks every block a chunk spans, not just the trailing one", () => {
    // Reproduces the live failure: a chunk covers a short heading block plus the
    // head of the following paragraph. The old code marked only the paragraph.
    document.body.innerHTML =
      "<h1>Chapter Four</h1>\n" +
      "<p>The feeding of the nine billion must continue without delay.</p>";

    const map = buildTextMap(document, document.body);
    // chunk text spans the heading + the start of the paragraph
    const chunk = "Chapter Four The feeding of the nine billion";
    const r = findChunkRange(chunk, map.text);
    expect(r).not.toBeNull();
    expect(r!.start).toBe(0);

    const count = wrapRangePerBlock(document, map, r!.start, r!.end);
    expect(count).toBe(2);

    const h1 = document.querySelector("h1")!;
    const p = document.querySelector("p")!;
    const h1Mark = h1.querySelector("mark.tts-chunk");
    const pMark = p.querySelector("mark.tts-chunk");
    expect(h1Mark).not.toBeNull();
    expect(pMark).not.toBeNull();
    expect(h1Mark!.textContent).toBe("Chapter Four");

    unwrapMarks(document);
    expect(document.querySelector("mark.tts-chunk")).toBeNull();
    expect(h1.textContent).toBe("Chapter Four");
  });
});
