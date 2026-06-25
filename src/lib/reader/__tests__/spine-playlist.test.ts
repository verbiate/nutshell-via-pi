import { describe, it, expect } from "vitest";
import { buildSpinePlaylist, type SpineItem } from "../spine-playlist";
import type { NavItem } from "@likecoin/epub-ts";

function makeSpine(hrefs: string[]): SpineItem[] {
  return hrefs.map((href, index) => ({ href, index }));
}

function makeToc(
  entries: { label: string; href: string; subitems?: NavItem[] }[],
): NavItem[] {
  return entries as NavItem[];
}

describe("buildSpinePlaylist", () => {
  it("labels continuation spine items so multi-file chapters read in full", () => {
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
        href: "text/part0005_split_000.html",
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
    const spine = makeSpine([
      "text/titlepage.xhtml",
      "text/chap1.xhtml",
    ]);
    const toc = makeToc([{ label: "Chapter 1", href: "text/chap1.xhtml" }]);

    const playlist = buildSpinePlaylist(spine, toc);

    expect(playlist.map((p) => ({ href: p.href, label: p.label }))).toEqual([
      { href: "text/titlepage.xhtml", label: "" },
      { href: "text/chap1.xhtml", label: "Chapter 1" },
    ]);
  });
});
