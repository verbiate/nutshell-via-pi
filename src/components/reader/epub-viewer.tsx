"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import ePub, { Book, Rendition, NavItem, Contents } from "@likecoin/epub-ts";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { buildParagraphMap, paragraphOffsetToCfi } from "@/lib/reader/position-tracking";
import type { ParagraphMap } from "@/lib/reader/position-tracking";
import { computeProgressPercent } from "@/lib/reader/progress";
import {
  pickTtsTargetIndex,
  findChunkRange,
  buildTextMap,
  unwrapMarks,
  wrapRangePerBlock,
  positionBlock,
  TTS_BLOCK_SELECTOR,
  type TextMap,
} from "@/lib/reader/tts-highlight-match";
import { splitSentences } from "@/lib/tts/chunk";
import {
  applyRelocated,
  DEFAULT_FOLLOW_STATE,
} from "@/lib/reader/follow-state";
import { READER_THEMES, READER_THEME_OVERRIDES } from "./themes";
import { buildRenditionOptions } from "./rendition-options";
import { highlightFill } from "./highlight-colors";
import { htmlToTtsText } from "@/lib/tts/prepare-text";

// ponytail: TTS follow-along only considers leaf text blocks. A block is a
// "container" (dropped) when it owns a block descendant with text, so wrapper
// <div>s don't swallow the highlight while heading/paragraph leaves stay live.
function hasTextBlockDescendant(el: HTMLElement): boolean {
  return Array.from(el.querySelectorAll<HTMLElement>(TTS_BLOCK_SELECTOR)).some(
    (d) => (d.textContent ?? "").trim().length > 0,
  );
}

// ponytail: navigate by block element, not text offset. wrapRangePerBlock
// extracts/wraps text nodes, which detaches/reindexes them and makes a
// text-offset CFI point at a node that no longer lives where its path claims
// → display() aborts ("No startContainer found"). A block element's position
// among its siblings is untouched by wrapping its *contents*, so its CFI
// resolves correctly pre- or post-wrap. Paragraphs are short, so the block
// start is on the chunk's page — this is how the page turns to follow the read.
function nodeToCfi(
  rendition: Rendition,
  node: Node,
): string | null {
  const view = rendition.manager?.current();
  const contents = view?.contents;
  if (!contents) return null;
  // ponytail: descend to the first non-empty text node before generating the
  // CFI. epub.js's locationOf builds a Range from the CFI and, when that range
  // is collapsed, defensively extends the end via setEnd(startContainer, r)
  // where r is a *character* offset derived from textContent. On an Element
  // startContainer (what cfiFromNode(block) yields), setEnd treats the offset
  // as a *child* index → IndexSizeError ("no child at offset N"). On a Text
  // node the offset is a character offset, which is what locationOf intends,
  // so the error never fires. The text node lives inside the block, so it's
  // in the same column → display() lands on the same page. nodeToCfi runs on
  // a clean DOM (marks cleared, before wrapping) and the CFI is consumed by
  // display() before any wrapping, so the text-node staleness the block-level
  // comment above guards against doesn't apply on this path.
  let target: Node = node;
  const doc = node.ownerDocument;
  if (doc && node.nodeType === 1) {
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let tn = walker.nextNode() as Text | null;
    while (tn) {
      if ((tn.nodeValue ?? "").trim().length > 0) {
        target = tn;
        break;
      }
      tn = walker.nextNode() as Text | null;
    }
  }
  try {
    return contents.cfiFromNode(target, "tts-chunk");
  } catch (err: any) {
    console.warn("[EpubViewer] cfiFromNode failed:", err);
    return null;
  }
}

// ponytail: first leaf text-block whose bounding rect overlaps the iframe's
// visible column. In epub.js's CSS-column manager, each "page" is one column;
// getBoundingClientRect inside the iframe is relative to that viewport, so
// blocks in the current column have left < innerWidth and right > 0. Falls
// back to the first leaf block if none qualify (edge: column boundary drift).
function getFirstVisibleBlock(doc: Document): Element | null {
  const win = doc.defaultView;
  const vw = win?.innerWidth ?? 800;
  const blocks = Array.from(
    doc.querySelectorAll<HTMLElement>(TTS_BLOCK_SELECTOR),
  ).filter((el) => !hasTextBlockDescendant(el));
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.right > 2 && rect.left < vw - 2) return block;
  }
  return blocks[0] ?? null;
}

// ponytail: ask epub.js for the current page's start CFI and resolve it back to
// a leaf text block. More reliable than getBoundingClientRect heuristics, which
// can fall back to blocks[0] (the chapter's first block) when the column
// transform state doesn't match the viewport. Falls back to null so callers can
// use getFirstVisibleBlock.
function resolveStartBlockFromLocation(
  rendition: Rendition | null,
  doc: Document,
): Element | null {
  if (!rendition) return null;
  try {
    const loc = (rendition as unknown as { currentLocation?: () => { start?: { cfi?: string } } }).currentLocation?.();
    const startCfi = loc?.start?.cfi;
    if (!startCfi) return null;
    const view = rendition.manager?.current();
    const contents = (view as unknown as { contents?: { range?: (cfi: string) => Range } })?.contents;
    if (!contents) return null;
    const range = contents.range?.(startCfi);
    if (!range?.startContainer) return null;
    let node: Node | null = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
      node = node.parentElement;
    }
    while (node && node !== doc.body) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as Element).matches(TTS_BLOCK_SELECTOR) &&
        !hasTextBlockDescendant(node as HTMLElement)
      ) {
        return node as Element;
      }
      node = (node as Element).parentElement ?? null;
    }
  } catch {
    // fall through to rect heuristic
  }
  return null;
}

// ponytail: char offset of `el`'s start within the section's TTS-normalized
// text. Clones body→el, serializes, runs the SAME htmlToTtsText transform the
// chunker uses — deterministic, no string matching.
function prefixTextOffset(doc: Document, el: Element): number {
  try {
    const range = doc.createRange();
    range.setStart(doc.body, 0);
    range.setEndBefore(el);
    const fragment = range.cloneContents();
    const wrapper = doc.createElement("div");
    wrapper.appendChild(fragment);
    return htmlToTtsText(wrapper.innerHTML).length;
  } catch {
    return 0;
  }
}

// ponytail: rendition.currentLocation().start.displayed.page as a number, 0 on
// failure. Used as a fallback when the iframe isn't actually translated.
function readDisplayedPage(rendition: unknown): number {
  try {
    const p = (
      rendition as {
        currentLocation?: () => {
          start?: { displayed?: { page?: string | number } };
        };
      }
    ).currentLocation?.()?.start?.displayed?.page;
    return typeof p === "number" ? p : parseInt(String(p ?? "0"), 10) || 0;
  } catch {
    return 0;
  }
}

// ponytail: TTS-text offset of an arbitrary DOM point (body start → (node,
// offset)). Used to turn a per-sentence caret position into the absolute char
// offset the chunker consumes.
function prefixOffsetTo(
  doc: Document,
  endNode: Node,
  endOffset: number,
): number {
  try {
    const range = doc.createRange();
    range.setStart(doc.body, 0);
    range.setEnd(endNode, endOffset);
    const fragment = range.cloneContents();
    const wrapper = doc.createElement("div");
    wrapper.appendChild(fragment);
    return htmlToTtsText(wrapper.innerHTML).length;
  } catch {
    return 0;
  }
}

// ponytail: bounding rect of a single character at `index` in the map. Used to
// tell which paginated column a chunk/sentence character lives in (a fragmented
// block's own rect spans columns and is useless for this). Null if the range
// can't be formed.
function charRectAt(
  doc: Document,
  map: TextMap,
  index: number,
): DOMRect | null {
  const startPos = map.positions[index];
  if (!startPos) return null;
  try {
    const range = doc.createRange();
    range.setStart(startPos.node, startPos.offset);
    const nodeLen = startPos.node.nodeValue?.length ?? 0;
    if (startPos.offset + 1 <= nodeLen) {
      range.setEnd(startPos.node, startPos.offset + 1);
    } else {
      const np = map.positions[index + 1];
      range.setEnd(np ? np.node : startPos.node, np ? np.offset : startPos.offset);
    }
    const rect = range.getBoundingClientRect();
    return rect.width > 0 ? rect : null;
  } catch {
    return null;
  }
}

export interface EpubViewerProps {
  url: string;
  theme: "light" | "dark" | "sepia";
  initialCfi?: string | null;
  // ponytail: dynamic typography overrides (font-size, font-family, line-height,
  // text-align, hyphens). Applied via themes.override on every change. Empty /
  // publisher-font = fall back to READER_THEME_OVERRIDES defaults.
  typography?: Record<string, string>;
  onPositionChange?: (
    position: { paragraphIndex: number; charOffset: number },
    cfi: string,
    percentage: number
  ) => void;
  onTocLoaded?: (toc: NavItem[]) => void;
  onProgressChange?: (percentage: number) => void;
  onSectionChange?: (href: string) => void;
  onRenditionReady?: (rendition: Rendition) => void;
  onNavigateRequest?: (href: string) => void;
  className?: string;
  onLoadChange?: (isLoaded: boolean) => void;
  onError?: (error: Error) => void;
  onTextSelected?: (cfiRange: string, contents: unknown) => void;
  onSelectionCleared?: () => void;
}

export interface EpubViewerHandle {
  navigateTo: (href: string, opts?: { ttsNav?: boolean }) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  getCurrentCfi: () => string | null;
  clearSelection: () => void;
  addHighlight: (cfi: string, color: string) => void;
  navigateToParagraph: (paragraphIndex: number) => Promise<void>;
  resize: () => void;
  getSectionText: () => string;
  highlightChunk: (text: string) => Promise<void>;
  clearTtsHighlight: () => void;
  /**
   * Fade the current chunk highlight out (paused=true → opacity 0) or back in
   * (paused=false). The marks stay in the DOM, so resume fades them back
   * without re-running the chunk matcher. No-op when no highlight is present.
   */
  setTtsPaused: (paused: boolean) => void;
  /**
   * Read-only probe: would highlightChunk locate `text` in the current
   * section's DOM? Used to gate re-highlight after an epub.js section re-render
   * so a stale chunk (mid TTS-driven section transition) no-ops instead of
   * clobbering the engine's own highlight via clearTtsHighlight + a wrong
   * fallback block. Builds the same text map as highlightChunk; does not modify
   * the DOM.
   */
  hasChunkText: (text: string) => boolean;
  /**
   * Navigate to `sectionHref` and page-advance until the chunk matched by
   * `anchorText` is visible — WITHOUT marking it. Used to restore the last
   * read-aloud position on book reopen (off-reader playback case where no CFI
   * was captured). Mirrors highlightChunk's locate + advance loop, minus marks.
   */
  showChunk: (sectionHref: string, anchorText: string) => Promise<void>;
  /**
   * Resolve a start position within the currently-rendered section to a
   * character offset in the section's TTS-normalized text. Used so TTS can
   * begin reading from a subsection heading or the current page instead of
   * always at the section head.
   *
   * - `elementId`: resolve `getElementById`, return prefix length up to it.
   * - `useVisible` (or no hint): use the first block visible in the iframe.
   *
   * Returns 0 when the target can't be resolved (no iframe, element missing).
   */
  getTtsStartOffset: (pos?: {
    elementId?: string;
    useVisible?: boolean;
  }) => number;
}

// ponytail: @likecoin/epub-ts returns nav-document hrefs RAW (relative to the
// nav doc's own location), but spine.get() looks up paths relative to the OPF
// package root. When the nav doc sits in a subdirectory (e.g. OEBPS/text/ for
// this book), the hrefs miss the prefix the spine stores and navigation misses
// with "No Section Found". Resolve by basename-matching against spine items so
// the same fix covers ToC navigation, the active-section highlight, and
// section-level Explainers (which all consume the normalized href).
function resolveSpineHref(book: Book, href: string): string {
  if (!href) return href;
  if (book.spine.get(href)) return href;

  const hashIdx = href.indexOf("#");
  const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const fragment = hashIdx >= 0 ? href.slice(hashIdx) : "";
  const basename = pathPart.split("/").pop();
  if (!basename) return href;

  let matched: string | null = null;
  book.spine.each((section) => {
    if (matched) return;
    const sh = section.href;
    if (sh && (sh === basename || sh.endsWith("/" + basename))) {
      matched = sh;
    }
  });
  return matched ? matched + fragment : href;
}

function normalizeTocHrefs(book: Book, items: NavItem[]): NavItem[] {
  return items.map((item) => ({
    ...item,
    href: resolveSpineHref(book, item.href),
    subitems: item.subitems?.length
      ? normalizeTocHrefs(book, item.subitems)
      : item.subitems,
  }));
}

export const EpubViewer = forwardRef<EpubViewerHandle, EpubViewerProps>(
  (
    {
      url,
      theme,
      initialCfi,
      typography,
      onPositionChange,
      onTocLoaded,
      onProgressChange,
      onSectionChange,
      onRenditionReady,
      className,
      onLoadChange,
      onError,
      onTextSelected,
      onSelectionCleared,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef<Book | null>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const paragraphMapRef = useRef<ParagraphMap | null>(null);

    const [isLoaded, setIsLoaded] = useState(false);
    // Track last known CFI for getCurrentCfi()
    const lastCfiRef = useRef<string | null>(null);
    // Guards one-time restore of the saved CFI once the rendition is ready.
    const restoredRef = useRef(false);
    // ponytail: mirrors the TTS paused state so the content hook can re-apply
    // the .tts-paused body class after epub.js recreates a section's iframe.
    const ttsPausedRef = useRef(false);
    // ponytail: follow-along state. Tracks whether the user has manually
    // navigated away from the TTS position so we don't yank them back. The
    // relocated event tags our own display() calls via ourNavInFlight; any
    // other relocated means the user drove the change. When their page/section
    // differs from where TTS left off, userBrowsedAway suppresses auto-advance
    // until they navigate back to the TTS page.
    const followStateRef = useRef(DEFAULT_FOLLOW_STATE);
    // ponytail: epub.js fires relocated 2-3× per display() (post-display,
    // SCROLLED, RESIZED), and the later fires can carry transient wrong-page
    // values. Clearing ourNavInFlight on the first relocated misattributes the
    // siblings to the user and sticks userBrowsedAway=true. Keep the flag true
    // for a short settle window after display() resolves so all sibling events
    // are absorbed as our own.
    const NAV_SETTLE_MS = 400;
    const navSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const markNavInFlight = () => {
      if (navSettleRef.current) clearTimeout(navSettleRef.current);
      followStateRef.current.ourNavInFlight = true;
    };
    const clearNavInFlight = () => {
      if (navSettleRef.current) clearTimeout(navSettleRef.current);
      navSettleRef.current = null;
      followStateRef.current.ourNavInFlight = false;
    };
    const scheduleNavSettle = () => {
      if (navSettleRef.current) clearTimeout(navSettleRef.current);
      navSettleRef.current = setTimeout(() => {
        followStateRef.current.ourNavInFlight = false;
      }, NAV_SETTLE_MS);
    };

    // Navigate method exposed via ref
    useImperativeHandle(ref, () => ({
      navigateTo: async (href: string, opts?: { ttsNav?: boolean }) => {
        // Hrefs are normalized at ToC-load time (see resolveSpineHref), so this
        // is just display() + a catch for "No Section Found" rejections so they
        // don't surface as unhandled rejections in Next.js's error overlay.
        // ttsNav: TTS-driven section changes must be tagged as our-nav so the
        // follow-state reducer doesn't mark them as the user browsing away —
        // otherwise auto-page-turn dies after page 1 of the new section.
        if (opts?.ttsNav) markNavInFlight();
        try {
          await renditionRef.current?.display(href);
          if (opts?.ttsNav) scheduleNavSettle();
        } catch (err: any) {
          if (opts?.ttsNav) clearNavInFlight();
          console.warn("[EpubViewer] navigateTo failed:", err);
        }
      },
      next: () => {
        if (!renditionRef.current) return Promise.resolve();
        return renditionRef.current.next();
      },
      prev: () => {
        if (!renditionRef.current) return Promise.resolve();
        return renditionRef.current.prev();
      },
      getCurrentCfi: () => lastCfiRef.current,
      clearSelection: () => {
        // Only clear the native browser selection — do NOT remove persisted annotations
        const iframe = containerRef.current?.querySelector("iframe");
        if (iframe?.contentWindow) {
          iframe.contentWindow.getSelection()?.removeAllRanges();
        }
      },
      addHighlight: (cfi: string, color: string) => {
        if (!renditionRef.current) return;
        renditionRef.current.annotations.highlight(
          cfi,
          {},
          () => {},
          "br-highlight",
          // ponytail: 50% alpha fill carries the highlight look; epub.js's
          // SVG annotation layer ignores mix-blend-mode, so the alpha fill is
          // the reliable baseline (multiply is applied in the UI swatches).
          // color is required — callers always pass a user-chosen swatch.
          { fill: highlightFill(color) }
        );
      },
      navigateToParagraph: async (paragraphIndex: number) => {
        if (!renditionRef.current || !bookRef.current) return;
        // Build paragraph map lazily on first use
        if (!paragraphMapRef.current) {
          paragraphMapRef.current = await buildParagraphMap(bookRef.current);
        }
        const cfi = paragraphOffsetToCfi(
          bookRef.current,
          { paragraphIndex, charOffset: 0 },
          paragraphMapRef.current
        );
        renditionRef.current.display(cfi).catch((err: Error) =>
          console.warn("[EpubViewer] navigateToParagraph failed:", err)
        );
      },
      resize: () => {
        // ponytail: no args — epub.js re-measures the container, so it picks up
        // the post-transition width automatically. Called on sidebar transitionend.
        // Guard: rendition.manager isn't assigned until the book has rendered;
        // calling resize() before that throws (`this.manager.resize` undefined).
        // The sidebar width transition now starts during entry (before the
        // EpubViewer mount), so its transitionend can beat the first render.
        // ponytail: manager-existence isn't a full readiness signal either —
        // epub.js's resize() also reads an internal `.size` (layout/stage) that
        // can still be undefined when transitionend beats the first render, and
        // pinning the exact property across versions is brittle. try/catch is
        // the honest guard: resize is idempotent, and epub.js's own
        // ResizeObserver re-measures on the next tick regardless. Silent catch —
        // this race is expected during entry, not a user-visible failure.
        const r = renditionRef.current as (Rendition & {
          manager?: unknown;
        }) | null;
        if (r && r.manager) {
          try {
            r.resize();
          } catch {
            /* rendition internals not ready; epub.js re-measures via its observers */
          }
        }
      },
      getSectionText: () => {
        // ponytail: read directly from the DOM iframe. Use the shared TTS text
        // prep helper so block boundaries (chapter numbers, titles, bylines)
        // become sentence-separated lines with full-stop pauses.
        const iframe = containerRef.current?.querySelector("iframe");
        const doc = iframe?.contentDocument;
        if (!doc?.body) return "";
        const clone = doc.body.cloneNode(true) as HTMLElement;
        return htmlToTtsText(clone.innerHTML);
      },
      highlightChunk: async (text: string) => {
        const iframe = containerRef.current?.querySelector("iframe");
        const doc = iframe?.contentDocument;
        if (!doc?.body || !text.trim()) return;

        // ponytail: leaf blocks, used only by the fallback path. A block is a
        // "container" (dropped) when it owns a block descendant with text, so
        // Calibre wrapper <div>s don't win the fallback while leaves stay live.
        const blocks = Array.from(
          doc.querySelectorAll<HTMLElement>(TTS_BLOCK_SELECTOR),
        ).filter((el) => !hasTextBlockDescendant(el));

        // ponytail: build ONE text map over the whole section body, then mark the
        // chunk's full span across every block it covers. A ~400-char chunk
        // regularly spans a heading + paragraph (or the tail of one paragraph and
        // the head of the next); the old single-block mark left that leading
        // portion spoken-but-unmarked — the "every other chunk" symptom.
        // wrapRangePerBlock splits the span at block boundaries so no <mark>
        // crosses a paragraph (which would flatten the paginated column layout).
        const map = buildTextMap(doc, doc.body);
        const range = findChunkRange(text, map.text);

        let startBlock: HTMLElement | null = null;
        if (range) {
          // ponytail: resolve the START BLOCK from the LIVE text map, before
          // any DOM mutation. Cross-realm: iframe elements fail instanceof
          // HTMLElement against the main window; null check instead.
          const ob = positionBlock(map, range.start);
          if (ob) startBlock = ob as HTMLElement;
        }

        // ponytail: auto-advance BEFORE wrapping marks. display()'s CFI
        // resolution walks the DOM tree; <mark> elements inserted by
        // wrapRangePerBlock shift child offsets and cause setEnd errors
        // (contents.ts:locationOf → Range.setEnd: "no child at offset N").
        // Calling display() on a clean DOM (marks already cleared by
        // clearTtsHighlight) avoids this. Within-section display is just a
        // column scroll — the iframe DOM doesn't change, so the text map
        // and range stay valid for the wrapping that follows.
        if (startBlock && !followStateRef.current.userBrowsedAway) {
          const rendition = renditionRef.current;
          if (rendition) {
            const chunkCfi = nodeToCfi(rendition, startBlock);
            if (chunkCfi) {
              markNavInFlight();
              try {
                await rendition.display(chunkCfi);
                scheduleNavSettle();
              } catch (err: any) {
                clearNavInFlight();
                console.warn("[EpubViewer] display(chunkCfi) failed:", err);
              }
            }
          }
        }

        // ponytail: visibility safety net. display(blockCfi) lands on the
        // block's START page — correct for normal blocks, but a block fragmented
        // across a page boundary starts on the previous page while the chunk's
        // spoken text is on this one. Advance columns until the chunk's START
        // CHARACTER is on the displayed page. We can't use the block's rect
        // (fragmented blocks span columns and never read as "visible"), and
        // doc.defaultView.innerWidth here is the full N×pageWidth strip, not one
        // page — so use the container width and the chunk char's own rect vs the
        // rendition's current displayed page. Cheap no-op when display() already
        // landed on the right page. Gated on !userBrowsedAway so a browsing user
        // isn't yanked back. next() is just a column translation, so the text
        // map/range above stay valid for the wrapping that follows.
        if (
          startBlock &&
          range &&
          !followStateRef.current.userBrowsedAway
        ) {
          const rendition = renditionRef.current;
          const pageW =
            containerRef.current?.getBoundingClientRect().width ??
            doc.defaultView?.innerWidth ??
            800;
          let safety = 0;
          while (rendition && safety < 4) {
            const cr = charRectAt(doc, map, range.start);
            if (!cr) break;
            const page = readDisplayedPage(rendition);
            const visLeft = page > 0 ? (page - 1) * pageW : 0;
            // char already on the displayed page (or before it) → done
            if (cr.left < visLeft + pageW) break;
            markNavInFlight();
            try {
              await rendition.next();
              scheduleNavSettle();
            } catch (err: any) {
              clearNavInFlight();
              console.warn("[EpubViewer] next() follow-along failed:", err);
              break;
            }
            safety++;
          }
        }

        // ponytail: NOW wrap marks on the (possibly just-scrolled) page.
        let marksCreated = 0;
        if (range) {
          marksCreated = wrapRangePerBlock(doc, map, range.start, range.end);
        }

        // ponytail: fallback when the matcher misses entirely (htmlToTtsText
        // period/entity drift defeats every probe needle): light the first
        // overlapping leaf block at block-level so we never silently show nothing.
        if (marksCreated === 0) {
          const idx = pickTtsTargetIndex(
            text,
            blocks.map((b) => b.textContent ?? ""),
          );
          const target = blocks[idx] ?? null;
          if (target) {
            target.classList.add("tts-active");
            if (!startBlock) startBlock = target;
          }
        }
      },
      clearTtsHighlight: () => {
        const iframe = containerRef.current?.querySelector("iframe");
        const doc = iframe?.contentDocument;
        if (!doc) return;
        unwrapMarks(doc);
        doc.querySelectorAll(".tts-active").forEach((el) =>
          el.classList.remove("tts-active"),
        );
      },
      setTtsPaused: (paused: boolean) => {
        ttsPausedRef.current = paused;
        const iframe = containerRef.current?.querySelector("iframe");
        iframe?.contentDocument?.body?.classList.toggle("tts-paused", paused);
      },
      // ponytail: read-only findability probe. Same map+range lookup as
      // highlightChunk, minus the marking + page-advance. Lets the re-highlight
      // path skip when the chunk isn't actually in this section's DOM (stale
      // chunk during a TTS-driven section swap), so we neither clobber the
      // engine's correct highlight nor light a wrong fallback block.
      hasChunkText: (text: string) => {
        const iframe = containerRef.current?.querySelector("iframe");
        const doc = iframe?.contentDocument;
        if (!doc?.body || !text.trim()) return false;
        const map = buildTextMap(doc, doc.body);
        return findChunkRange(text, map.text) !== null;
      },
      showChunk: async (sectionHref: string, anchorText: string) => {
        if (!sectionHref || !anchorText.trim()) return;
        // ponytail: jump to the section first. navigateTo is display(href); it
        // no-ops cleanly if the section is already current. Await a short settle
        // so the iframe DOM for the target section is present before we map it.
        markNavInFlight();
        try {
          await renditionRef.current?.display(sectionHref);
          scheduleNavSettle();
        } catch (err: any) {
          clearNavInFlight();
          console.warn("[EpubViewer] showChunk section nav failed:", err);
          return;
        }
        await new Promise((r) => setTimeout(r, 120));

        const iframe = containerRef.current?.querySelector("iframe");
        const doc = iframe?.contentDocument;
        if (!doc?.body) return;

        // ponytail: reuse the same chunk-location machinery as highlightChunk,
        // then jump directly to the START BLOCK's CFI. No marks, no tts-active.
        const map = buildTextMap(doc, doc.body);
        const range = findChunkRange(anchorText, map.text);
        if (!range) {
          // Anchor couldn't be re-located (engine/text drift). The section's
          // first page is already on screen from the display() above — leave it.
          return;
        }

        const startBlock = positionBlock(map, range.start);
        if (!startBlock) return;

        const rendition = renditionRef.current;
        if (!rendition) return;
        const chunkCfi = nodeToCfi(rendition, startBlock);
        if (!chunkCfi) return;
        markNavInFlight();
        try {
          await rendition.display(chunkCfi);
          scheduleNavSettle();
        } catch (err: any) {
          clearNavInFlight();
          console.warn("[EpubViewer] showChunk display(chunkCfi) failed:", err);
        }
      },
      getTtsStartOffset: (pos?: { elementId?: string; useVisible?: boolean }) => {
        const iframe = containerRef.current?.querySelector("iframe");
        const doc = iframe?.contentDocument;
        if (!doc?.body) return 0;

        if (pos?.elementId) {
          const el = doc.getElementById(pos.elementId);
          if (el) return prefixTextOffset(doc, el);
        }

        // ponytail: GEOMETRIC visible-page resolution. epub.js paginated lays
        // the whole section in one wide iframe (innerWidth = N × pageWidth)
        // translated inside the container (= one pageWidth); currentLocation's
        // start.cfi resolves ~one page off on this layout, so use the geometry:
        // the container is a pageWidth window into the translated iframe, and
        // container.left − iframe.left tells us how far in we are. Falls back to
        // displayed.page when the iframe isn't translated (scroll manager) or
        // we're on page 1.
        const containerRect = containerRef.current?.getBoundingClientRect();
        const iframeRect = iframe?.getBoundingClientRect();
        const pageW = containerRect?.width ?? doc.defaultView?.innerWidth ?? 800;

        let visLeft = -1;
        if (containerRect && iframeRect) {
          const t = containerRect.left - iframeRect.left;
          if (t > 1) visLeft = t;
        }
        if (visLeft < 0) {
          const page = readDisplayedPage(renditionRef.current);
          visLeft = page > 0 ? (page - 1) * pageW : 0;
        }

        // ponytail: first leaf block whose rect OVERLAPS the visible window.
        // A block fragmented across the page boundary (starts on the previous
        // page, continues onto this one) is included so its on-page sentences
        // aren't skipped.
        const visRight = visLeft + pageW;
        const blocks = Array.from(
          doc.querySelectorAll<HTMLElement>(TTS_BLOCK_SELECTOR),
        ).filter((el) => !hasTextBlockDescendant(el));
        let vi = -1;
        for (let i = 0; i < blocks.length; i++) {
          const r = blocks[i].getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.right > visLeft && r.left < visRight) {
            vi = i;
            break;
          }
        }
        if (vi < 0) {
          // last-resort fallback (CFI is off-by-one on this layout, but > 0)
          const fb =
            resolveStartBlockFromLocation(renditionRef.current, doc) ??
            getFirstVisibleBlock(doc);
          return fb ? prefixTextOffset(doc, fb) : 0;
        }

        const block = blocks[vi];
        const br = block.getBoundingClientRect();

        // Block STARTS on the visible page → its start offset.
        if (br.left >= visLeft - 1) {
          return prefixTextOffset(doc, block);
        }

        // Block spans from a previous page → find the first SENTENCE within it
        // whose rendered start is on the visible page. buildTextMap gives a
        // per-char DOM position; per-sentence ranges read their column via
        // getBoundingClientRect without trusting caretRangeFromPoint (which is
        // unreliable on this translated-iframe layout).
        const map = buildTextMap(doc, block);
        const sentences = splitSentences(map.text);
        let searchFrom = 0;
        for (const sentence of sentences) {
          if (sentence.length < 2) continue;
          const s = map.text.indexOf(sentence, searchFrom);
          if (s < 0) break;
          searchFrom = s + sentence.length;
          const rect = charRectAt(doc, map, s);
          if (!rect) continue;
          if (rect.left >= visLeft - 1 && rect.left < visRight) {
            const startPos = map.positions[s];
            return prefixOffsetTo(doc, startPos.node, startPos.offset);
          }
        }

        // every sentence failed to resolve (rare) → block start (prev page)
        return prefixTextOffset(doc, block);
      },
    }));

    // ponytail: many EPUBs ship `body { background-color: white; color: black; }`,
    // which beats the registered theme rules on specificity. Force the theme's
    // page colors with !important so the book background always matches the app.
    const applyThemeOverrides = useCallback(
      (selected: "light" | "dark" | "sepia") => {
        const rendition = renditionRef.current;
        if (!rendition) return;
        rendition.themes.select(selected);
        const body = READER_THEMES[selected].rules.body;
        rendition.themes.override("background-color", body.background, true);
        rendition.themes.override("color", body.color, true);
      },
      []
    );

    // Initialize EPUB book
    useEffect(() => {
      if (!url || !containerRef.current) return;

      let mounted = true;
      setIsLoaded(false);
      onLoadChange?.(false);
      restoredRef.current = false;

      fetch(url)
        .then((res) => {
          if (!res.ok) {
            throw new Error(
              `Failed to fetch EPUB: ${res.status} ${res.statusText}`
            );
          }
          return res.arrayBuffer();
        })
        .then((arrayBuffer) => {
          if (!mounted || !containerRef.current) return;

          const book = ePub(arrayBuffer);
          bookRef.current = book;

          // ponytail: epub-ts Spine.get() checks spineByHref[target] ??
          // spineByHref[encodeURI(target)] but never decodeURI(target). Calibre NCX
          // hrefs percent-encode chars the OPF keeps literal (CR%21… vs CR!…), so
          // encoded ToC/in-content hrefs miss and rendition.display() rejects with
          // "No Section Found" — dead ToC links + the in-book hyperlink crash. The
          // missing lookup is decodeURI. Wrap once at this single choke point: ToC
          // clicks, in-content links, TTS, and Explainer nav all funnel through
          // spine.get/display. Drop the wrap if epub-ts adds decodeURI to get().
          const spine = book.spine;
          const origGet = spine.get.bind(spine);
          spine.get = (target?: string | number) => {
            const found = origGet(target);
            if (found) return found;
            if (typeof target === "string") {
              try {
                const decoded = decodeURI(target);
                if (decoded !== target) return origGet(decoded);
              } catch {
                // malformed %-sequence; leave unresolved
              }
            }
            return null;
          };

          return book.ready.then(() => {
            if (!mounted || !containerRef.current) return;

            // Extract and expose ToC (normalize hrefs so they resolve on the spine)
            if (book.navigation?.toc) {
              onTocLoaded?.(normalizeTocHrefs(book, book.navigation.toc));
            }

            // Render to container iframe
            const rendition = book.renderTo(containerRef.current, buildRenditionOptions());
            renditionRef.current = rendition;

            rendition.themes.register("light", READER_THEMES.light);
            rendition.themes.register("dark", READER_THEMES.dark);
            rendition.themes.register("sepia", READER_THEMES.sepia);

            // Apply current theme
            applyThemeOverrides(theme);

            // ponytail: epub.js sets its own body styles in paginated mode that
            // override stylesheet rules. Force typography/layout through as
            // inline !important so margins and fonts actually take effect.
            for (const [prop, value] of Object.entries(READER_THEME_OVERRIDES)) {
              rendition.themes.override(prop, value, true);
            }

            // ponytail: themes.register's type/runtime mismatch drops these
            // rules, so inject the highlight CSS directly via the same
            // addStylesheetCss path as the image blend below. Emits both the
            // block-level fallback (.tts-active) and the per-chunk span (.tts-chunk),
            // plus a .tts-paused body-class variant that fades the highlight
            // background/box-shadow out when audio is paused (the marks stay in
            // the DOM so resume fades them back in without re-locating the chunk).
            const ttsHighlightCss = Object.entries(READER_THEMES)
              .flatMap(([name, theme]) => {
                const rules = theme.rules as unknown as Record<
                  string,
                  Record<string, string>
                >;
                const base = ([".tts-active", ".tts-chunk"] as const)
                  .filter((sel) => rules[sel])
                  .map((sel) => {
                    const declarations = Object.entries(rules[sel])
                      .map(([prop, value]) => `${prop}: ${value};`)
                      .join(" ");
                    return `.${name} ${sel} { ${declarations} }`;
                  });
                const paused =
                  `.${name}.tts-paused .tts-active, ` +
                  `.${name}.tts-paused .tts-chunk { background-color: transparent; box-shadow: none; }`;
                return [...base, paused];
              })
              .join("\n");

            rendition.hooks.content.register((contents: Contents) => {
              contents.addStylesheetCss(ttsHighlightCss, "br-tts-highlight");
              // ponytail: re-apply the paused class on every section render —
              // epub.js rebuilds the iframe body across section boundaries, so a
              // class toggled on the previous body is lost otherwise.
              const body = (contents as unknown as { document?: Document })
                .document?.body;
              if (body)
                body.classList.toggle("tts-paused", ttsPausedRef.current);
            });

            // ponytail: cream/sepia paper bg makes white-background images
            // float as bright boxes. multiply lets them absorb the page tint.
            // Scoped to the .light/.sepia class epub.js puts on the content
            // body (themes.select → addClass); dark is excluded because
            // multiply on near-black erases images.
            rendition.hooks.content.register((contents: Contents) => {
              contents.addStylesheetCss(
                ".light img, .sepia img { mix-blend-mode: multiply; }",
                "br-image-blend",
              );
            });

            // Wire relocated event for progress and position
            rendition.on(
              "relocated",
              (location: any) => {
                if (!mounted) return;
                const cfi = location.start.cfi ?? null;
                lastCfiRef.current = cfi;
                // ponytail: percentage is the source of truth for bookshelf
                // progress bars — it comes straight from epub.js locations, which
                // are EPUB-structure-agnostic (unlike paragraphIndex). It reads 0
                // until book.locations.generate() resolves (background, after first
                // display), then reflects the real position on subsequent moves.
                const percentage = Math.round((location.start.percentage ?? 0) * 100);
                onProgressChange?.(percentage);
                // ponytail: surface the current spine href so the reader tracks
                // section identity on every page turn (not just ToC clicks) —
                // drives the TTS "now reading" label and the active ToC row.
                if (location.start?.href) onSectionChange?.(location.start.href);
                onPositionChange?.({ paragraphIndex: 0, charOffset: 0 }, cfi ?? "", percentage);

                // ponytail: follow-along tracking. If ourNavInFlight is set,
                // this relocated came from our own display() — record where TTS
                // landed and clear the browsed-away flag. Otherwise the user
                // drove the navigation: if their page or section differs from
                // where TTS left off, they've browsed away (suppress auto-advance
                // until they return). ourNavInFlight is kept true for a settle
                // window after display() resolves so epub.js's 2-3 sibling
                // relocated events are absorbed as our own.
                const page = location.start.displayed?.page ?? null;
                const href = location.start.href ?? null;
                followStateRef.current = applyRelocated(
                  followStateRef.current,
                  { ourNav: followStateRef.current.ourNavInFlight, page, href },
                );
              }
            );

            // Wire text selection events
            rendition.on("selected", (cfiRange: string, contents: unknown) => {
              if (!mounted) return;
              onTextSelected?.(cfiRange, contents);
            });

            // Display the book first. Saved-CFI restore is handled by the
            // [initialCfi, isLoaded] effect below (initialCfi is null on first
            // mount; it arrives after the position fetch resolves).
            const displayPromise = rendition.display();

            // ponytail: epub.js needs locations generated before location.start.percentage
            // returns a value. Background-generate after first display so the progress bar
            // reflects the actual reading position without blocking the reader's first paint.
            displayPromise.then(() => {
              book.locations
                .generate(1600)
                .then(() => {
                  if (!mounted) return;
                  const pct = computeProgressPercent(book, lastCfiRef.current);
                  onProgressChange?.(pct);
                  // Re-emit position so the persisted percentage reflects the real
                  // location once locations are ready — before any page turn. This
                  // is what makes a resumed book keep its accurate progress bar.
                  onPositionChange?.(
                    { paragraphIndex: 0, charOffset: 0 },
                    lastCfiRef.current ?? "",
                    Math.round(pct)
                  );
                })
                .catch((err: Error) =>
                  console.warn("[EpubViewer] locations.generate failed:", err),
                );
            });

            return displayPromise;
          });
        })
        .then(() => {
          if (!mounted) return;
          setIsLoaded(true);
          onLoadChange?.(true);
          onRenditionReady?.(renditionRef.current!);
        })
        .catch((err: Error) => {
          if (!mounted) return;
          console.error("[EpubViewer] Failed to load EPUB:", err);
          onError?.(err);
        });

      return () => {
        mounted = false;
        clearNavInFlight();
        try {
          renditionRef.current?.destroy();
          bookRef.current?.destroy();
        } catch {
          // Ignore cleanup errors
        }
        renditionRef.current = null;
        bookRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url]);

    // Restore saved reading position once the CFI arrives (after the position
    // fetch resolves) and the rendition is ready. Runs at most once per book.
    useEffect(() => {
      if (!initialCfi || !isLoaded || restoredRef.current) return;
      restoredRef.current = true;
      renditionRef.current?.display(initialCfi).catch((err: Error) =>
        console.warn("[EpubViewer] CFI restore failed:", err)
      );
    }, [initialCfi, isLoaded]);

    // Sync theme changes
    useEffect(() => {
      applyThemeOverrides(theme);
    }, [theme, applyThemeOverrides]);

    // Apply dynamic typography overrides (font size/family/spacing from settings panel).
    // ponytail: themes.override updates the registered rule in place, so the last
    // write wins over READER_THEME_OVERRIDES defaults set at init.
    useEffect(() => {
      const rendition = renditionRef.current;
      if (!rendition || !typography) return;
      for (const [prop, value] of Object.entries(typography)) {
        rendition.themes.override(prop, value, true);
      }
    }, [typography]);

    return (
      <div className={cn("relative h-full w-full", className)}>
        <div
          className="h-full w-full"
          style={{
            padding:
              "clamp(56px, 7vh, 96px) clamp(80px, 16vw, 200px)",
          }}
        >
          <div
            ref={containerRef}
            className="h-full w-full"
            style={{ minWidth: 680 }}
            aria-label="Book content"
          />
        </div>
        {!isLoaded && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background gap-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
            <div className="mt-8 space-y-3 w-[300px]">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-[92%]" />
              <Skeleton className="h-3 w-[96%]" />
              <Skeleton className="h-3 w-[88%]" />
              <Skeleton className="h-3 w-[94%]" />
            </div>
          </div>
        )}
      </div>
    );
  }
);

EpubViewer.displayName = "EpubViewer";
