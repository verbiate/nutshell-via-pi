import { describe, it, expect } from "vitest";
import { buildSpinePlaylist, type SpineItem } from "../spine-playlist";
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
