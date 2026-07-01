import { describe, it, expect } from "vitest";
import { buildSpinePlaylist, nextLeafFragmentInSameFile, type SpineItem } from "../spine-playlist";
import type { NavItem } from "@likecoin/epub-ts";

function makeSpine(hrefs: string[]): SpineItem[] {
  return hrefs.map((href, index) => ({ href, index }));
}

type LooseNavItem = {
  label: string;
  href: string;
  id?: string;
  subitems?: LooseNavItem[];
};

function makeToc(entries: LooseNavItem[]): NavItem[] {
  return entries as NavItem[];
}

describe("buildSpinePlaylist", () => {
  it("emits one entry per ToC leaf, fragment preserved", () => {
    // Analects shape: many verse fragments into one shared XHTML file.
    const spine = makeSpine(["text/book1.xhtml"]);
    const toc = makeToc([
      { label: "I.1", href: "text/book1.xhtml#v1" },
      { label: "I.2", href: "text/book1.xhtml#v2" },
      { label: "I.3", href: "text/book1.xhtml#v3" },
    ]);

    const playlist = buildSpinePlaylist(spine, toc);

    expect(playlist.map((p) => ({ href: p.href, label: p.label }))).toEqual([
      { href: "text/book1.xhtml#v1", label: "I.1" },
      { href: "text/book1.xhtml#v2", label: "I.2" },
      { href: "text/book1.xhtml#v3", label: "I.3" },
    ]);
    expect(playlist.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it("labels continuation splits off the prior leaf for multi-file chapters", () => {
    // Calibre-style split: one ToC entry on the first split, rest are orphans.
    const spine = makeSpine([
      "text/part0005_split_000.html",
      "text/part0005_split_001.html",
      "text/part0005_split_002.html",
    ]);
    const toc = makeToc([
      {
        label: "Chapter 2: Thinking Old Power, Thinking New Power",
        href: "text/part0005_split_000.html#4OIQ0",
      },
    ]);

    const playlist = buildSpinePlaylist(spine, toc);

    expect(playlist.map((p) => ({ href: p.href, label: p.label }))).toEqual([
      {
        href: "text/part0005_split_000.html#4OIQ0",
        label: "Chapter 2: Thinking Old Power, Thinking New Power",
      },
      {
        href: "text/part0005_split_001.html",
        label: "Chapter 2: Thinking Old Power, Thinking New Power (continued)",
      },
      {
        href: "text/part0005_split_002.html",
        label: "Chapter 2: Thinking Old Power, Thinking New Power (continued)",
      },
    ]);
  });

  it("skips nonlinear spine items", () => {
    const spine: SpineItem[] = [
      { href: "text/chap1.xhtml", index: 0 },
      { href: "text/notes.xhtml", index: 1, linear: false },
      { href: "text/chap2.xhtml", index: 2 },
    ];
    const toc = makeToc([
      { label: "Chapter 1", href: "text/chap1.xhtml" },
      { label: "Chapter 2", href: "text/chap2.xhtml" },
    ]);

    const playlist = buildSpinePlaylist(spine, toc);

    expect(playlist.map((p) => p.href)).toEqual([
      "text/chap1.xhtml",
      "text/chap2.xhtml",
    ]);
  });

  it("keeps unnamed front matter before the first ToC entry", () => {
    const spine = makeSpine(["text/titlepage.xhtml", "text/chap1.xhtml"]);
    const toc = makeToc([{ label: "Chapter 1", href: "text/chap1.xhtml" }]);

    const playlist = buildSpinePlaylist(spine, toc);

    expect(playlist.map((p) => ({ href: p.href, label: p.label }))).toEqual([
      { href: "text/titlepage.xhtml", label: "" },
      { href: "text/chap1.xhtml", label: "Chapter 1" },
    ]);
  });

  it("dedups repeated nav points (first occurrence wins)", () => {
    const spine = makeSpine(["text/chap1.xhtml"]);
    const toc = makeToc([
      { label: "Chapter 1", href: "text/chap1.xhtml" },
      { label: "Chapter 1 (again)", href: "text/chap1.xhtml" },
    ]);

    const playlist = buildSpinePlaylist(spine, toc);

    expect(playlist).toHaveLength(1);
    expect(playlist[0].label).toBe("Chapter 1");
  });

  it("drops bare-href headings when fragments subdivide the same file", () => {
    // Analects-real shape: a flat "Book I" heading (bare href) immediately
    // followed by verse fragments into the same file. The heading would read
    // the whole file then re-read verse 1 on advance, so it's dropped.
    const spine = makeSpine(["text/book1.xhtml"]);
    const toc = makeToc([
      { label: "Book I", href: "text/book1.xhtml" },
      { label: "I.1", href: "text/book1.xhtml#v1" },
      { label: "I.2", href: "text/book1.xhtml#v2" },
    ]);

    const playlist = buildSpinePlaylist(spine, toc);

    expect(playlist.map((p) => p.label)).toEqual(["I.1", "I.2"]);
  });

  it("flattens nested ToCs depth-first in reading order", () => {
    const spine = makeSpine(["text/book1.xhtml", "text/book2.xhtml"]);
    const toc = makeToc([
      {
        label: "Book I",
        href: "text/book1.xhtml",
        subitems: [
          { label: "I.1", href: "text/book1.xhtml#v1" },
          { label: "I.2", href: "text/book1.xhtml#v2" },
        ],
      },
      {
        label: "Book II",
        href: "text/book2.xhtml",
        subitems: [{ label: "II.1", href: "text/book2.xhtml#w1" }],
      },
    ]);

    const playlist = buildSpinePlaylist(spine, toc);

    // ponytail: parent headings are dropped (their files are subdivided by
    // fragment leaves); only the verse leaves survive, depth-first.
    expect(playlist.map((p) => p.label)).toEqual(["I.1", "I.2", "II.1"]);
  });
});

describe("nextLeafFragmentInSameFile", () => {
  // ponytail: Blitzscaling-shape — s15 "The Three Basics" is followed by s19
  // in the ToC, but the DOM carries s16/s17/s18 as non-ToC sub-section ids
  // between them. The extractor must bound s15's range at s19 (the next ToC
  // leaf), not s16 (the next DOM id).
  it("returns the next ToC leaf's fragment when it shares the same file", () => {
    const flat = buildSpinePlaylist(
      [
        { href: "c001.xhtml", index: 0 },
        { href: "c002.xhtml", index: 1 },
      ],
      [
        { label: "Three Basics", href: "c001.xhtml#s15" },
        { label: "Five Stages", href: "c001.xhtml#s19" },
        { label: "Next Chapter", href: "c002.xhtml#s1" },
      ] as NavItem[],
    );
    expect(nextLeafFragmentInSameFile(flat, "c001.xhtml#s15")).toBe("s19");
  });

  it("returns undefined when the next leaf is in a different file (chapter end)", () => {
    const flat = buildSpinePlaylist(
      [{ href: "c001.xhtml", index: 0 }, { href: "c002.xhtml", index: 1 }],
      [
        { label: "Last Section", href: "c001.xhtml#s19" },
        { label: "Next Chapter", href: "c002.xhtml#s1" },
      ] as NavItem[],
    );
    expect(nextLeafFragmentInSameFile(flat, "c001.xhtml#s19")).toBeUndefined();
  });

  it("returns undefined when the href is not in the flatToc", () => {
    const flat = buildSpinePlaylist(
      [{ href: "c001.xhtml", index: 0 }],
      [{ label: "S1", href: "c001.xhtml#s1" }] as NavItem[],
    );
    expect(nextLeafFragmentInSameFile(flat, "c001.xhtml#unknown")).toBeUndefined();
  });

  it("tolerates path prefixes (OEBPS/... vs bare) via basename compare", () => {
    const flat = buildSpinePlaylist(
      [{ href: "OEBPS/c001.xhtml", index: 0 }],
      [
        { label: "A", href: "OEBPS/c001.xhtml#s15" },
        { label: "B", href: "OEBPS/c001.xhtml#s19" },
      ] as NavItem[],
    );
    // caller passes a prefixed href; flatToc carries the same prefix
    expect(nextLeafFragmentInSameFile(flat, "OEBPS/c001.xhtml#s15")).toBe("s19");
  });
});
