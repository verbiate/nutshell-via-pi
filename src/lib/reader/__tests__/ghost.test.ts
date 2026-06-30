import { describe, it, expect } from "vitest";
import {
  ghostOffset,
  resolveGhostItem,
  resolveAdvance,
  deriveGhost,
} from "../ghost";
import type { FlatSection } from "@/lib/reader/spine-playlist";
import type { PlaylistItem } from "@/types/playlist";

const toc = (n: number): FlatSection[] =>
  Array.from({ length: n }, (_, i) => ({
    href: `ch${i}.xhtml`,
    label: `Ch ${i}`,
    index: i,
  }));

const exact = (a: string, b: string) => a === b;

function mkItem(over: Partial<PlaylistItem>): PlaylistItem {
  return {
    id: "x",
    userId: "u",
    kind: "section",
    bookId: "b",
    sectionHref: "ch0.xhtml",
    sectionLabel: "Ch 0",
    text: null,
    position: 0,
    status: "upcoming",
    bookTitle: null,
    bookAuthor: null,
    bookCoverPath: null,
    bookLanguage: "en",
    addedAt: "",
    playedAt: null,
    ...over,
  };
}

describe("ghostOffset", () => {
  it("returns currentIndex+1 when within bounds", () => {
    expect(ghostOffset(2, 0, 4, 5)).toBe(3);
  });
  it("clamps up to startIndex when active is in front matter", () => {
    expect(ghostOffset(0, 2, 4, 5)).toBe(2);
  });
  it("returns null at the last readable section (exhausted)", () => {
    expect(ghostOffset(4, 0, 4, 5)).toBeNull();
  });
  it("returns null past the readable end", () => {
    expect(ghostOffset(5, 0, 4, 5)).toBeNull();
  });
  it("returns null when window is invalid (start > end)", () => {
    expect(ghostOffset(2, 4, 1, 5)).toBeNull();
  });
  it("treats full spine as window when start=0 end=len-1", () => {
    expect(ghostOffset(0, 0, 4, 5)).toBe(1);
  });
});

describe("resolveGhostItem", () => {
  it("resolves next section href+label within the readable window", () => {
    const g = resolveGhostItem(toc(5), 1, "ch0.xhtml", "ch4.xhtml", exact);
    expect(g).toEqual({ sectionHref: "ch2.xhtml", sectionLabel: "Ch 2" });
  });
  it("jumps to readable start when active is in front matter", () => {
    const g = resolveGhostItem(toc(5), 0, "ch2.xhtml", "ch4.xhtml", exact);
    expect(g?.sectionHref).toBe("ch2.xhtml");
  });
  it("returns null when active is the readable end", () => {
    const g = resolveGhostItem(toc(5), 4, "ch0.xhtml", "ch4.xhtml", exact);
    expect(g).toBeNull();
  });
  it("returns null when readable hrefs are absent from flatToc", () => {
    const g = resolveGhostItem(toc(5), 1, "ch0.xhtml", "missing.xhtml", exact);
    expect(g).toBeNull();
  });
  it("uses the whole spine when bounds are null", () => {
    const g = resolveGhostItem(toc(5), 3, null, null, exact);
    expect(g?.sectionHref).toBe("ch4.xhtml");
  });
});

describe("resolveAdvance", () => {
  const ghost = { sectionHref: "ch2.xhtml", sectionLabel: "Ch 2" };
  const manual = mkItem({ id: "m1" });

  it("ghost leads when present", () => {
    expect(
      resolveAdvance({
        ghostItem: ghost,
        manualNext: manual,
        atReadableEnd: false,
        atEndOfToc: false,
      }),
    ).toEqual({ kind: "ghost", ghost });
  });
  it("manual leads when ghost absent", () => {
    expect(
      resolveAdvance({
        ghostItem: null,
        manualNext: manual,
        atReadableEnd: false,
        atEndOfToc: false,
      }),
    ).toEqual({ kind: "manual", item: manual });
  });
  it("terminal when at readable end and nothing else", () => {
    expect(
      resolveAdvance({
        ghostItem: null,
        manualNext: null,
        atReadableEnd: true,
        atEndOfToc: false,
      }),
    ).toEqual({ kind: "terminal" });
  });
  it("terminal at end of flat toc", () => {
    expect(
      resolveAdvance({
        ghostItem: null,
        manualNext: null,
        atReadableEnd: false,
        atEndOfToc: true,
      }),
    ).toEqual({ kind: "terminal" });
  });
  it("idle when nothing to do", () => {
    expect(
      resolveAdvance({
        ghostItem: null,
        manualNext: null,
        atReadableEnd: false,
        atEndOfToc: false,
      }),
    ).toEqual({ kind: "idle" });
  });
});

describe("deriveGhost", () => {
  const sess = (over: Partial<{}> = {}) => ({
    bookId: "b",
    flatToc: toc(5),
    currentIndex: 1,
    readableStartSectionHref: "ch0.xhtml",
    readableEndSectionHref: "ch4.xhtml",
    ...over,
  });
  const active = { bookId: "b" };

  it("returns null when auto-advance is off", () => {
    expect(deriveGhost(false, sess(), active, exact)).toBeNull();
  });
  it("returns null when session is null", () => {
    expect(deriveGhost(true, null, active, exact)).toBeNull();
  });
  it("returns null when active is null", () => {
    expect(deriveGhost(true, sess(), null, exact)).toBeNull();
  });
  it("returns null when active belongs to another book", () => {
    expect(deriveGhost(true, sess(), { bookId: "other" }, exact)).toBeNull();
  });
  it("returns the next readable section otherwise", () => {
    expect(deriveGhost(true, sess(), active, exact)?.sectionHref).toBe(
      "ch2.xhtml",
    );
  });
});
