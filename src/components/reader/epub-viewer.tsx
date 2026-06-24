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
} from "@/lib/reader/tts-highlight-match";
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
  navigateTo: (href: string) => Promise<void>;
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
   * Navigate to `sectionHref` and page-advance until the chunk matched by
   * `anchorText` is visible — WITHOUT marking it. Used to restore the last
   * read-aloud position on book reopen (off-reader playback case where no CFI
   * was captured). Mirrors highlightChunk's locate + advance loop, minus marks.
   */
  showChunk: (sectionHref: string, anchorText: string) => Promise<void>;
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

    // Navigate method exposed via ref
    useImperativeHandle(ref, () => ({
      navigateTo: async (href: string) => {
        // Hrefs are normalized at ToC-load time (see resolveSpineHref), so this
        // is just display() + a catch for "No Section Found" rejections so they
        // don't surface as unhandled rejections in Next.js's error overlay.
        try {
          await renditionRef.current?.display(href);
        } catch (err: any) {
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

        let marksCreated = 0;
        let startBlock: HTMLElement | null = null;
        if (range) {
          marksCreated = wrapRangePerBlock(doc, map, range.start, range.end);
          const ob = positionBlock(map, range.start);
          if (ob instanceof HTMLElement) startBlock = ob;
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

        // ponytail: scroll the chunk's START block into view. In epub.js
        // paginated mode the DOM persists across column shifts, so reading the
        // start block's geometry around next() stays valid.
        if (startBlock) {
          const isVisible = (): boolean => {
            const rect = startBlock!.getBoundingClientRect();
            const vw = iframe?.clientWidth ?? 0;
            const vh = iframe?.clientHeight ?? 0;
            return rect.left < vw && rect.right > 0 && rect.top < vh && rect.bottom > 0;
          };
          if (!isVisible()) {
            const rendition = renditionRef.current;
            if (rendition) {
              for (let i = 0; i < 8 && !isVisible(); i++) {
                rendition.next();
                // ponytail: let the column layout settle before re-checking.
                await new Promise((r) => setTimeout(r, 60));
              }
            }
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
      showChunk: async (sectionHref: string, anchorText: string) => {
        if (!sectionHref || !anchorText.trim()) return;
        // ponytail: jump to the section first. navigateTo is display(href); it
        // no-ops cleanly if the section is already current. Await a short settle
        // so the iframe DOM for the target section is present before we map it.
        try {
          await renditionRef.current?.display(sectionHref);
        } catch (err: any) {
          console.warn("[EpubViewer] showChunk section nav failed:", err);
          return;
        }
        await new Promise((r) => setTimeout(r, 60));

        const iframe = containerRef.current?.querySelector("iframe");
        const doc = iframe?.contentDocument;
        if (!doc?.body) return;

        // ponytail: reuse the same chunk-location machinery as highlightChunk,
        // but only to find the START block — we advance pages until it's
        // visible and stop. No marks, no tts-active class.
        const map = buildTextMap(doc, doc.body);
        const range = findChunkRange(anchorText, map.text);
        let startBlock: HTMLElement | null = null;
        if (range) {
          const ob = positionBlock(map, range.start);
          if (ob instanceof HTMLElement) startBlock = ob;
        }

        if (!startBlock) {
          // Anchor couldn't be re-located (engine/text drift). The section's
          // first page is already on screen from the display() above — leave it.
          return;
        }

        const isVisible = (): boolean => {
          const rect = startBlock!.getBoundingClientRect();
          const vw = iframe?.clientWidth ?? 0;
          const vh = iframe?.clientHeight ?? 0;
          return rect.left < vw && rect.right > 0 && rect.top < vh && rect.bottom > 0;
        };
        if (isVisible()) return;
        const rendition = renditionRef.current;
        if (!rendition) return;
        for (let i = 0; i < 8 && !isVisible(); i++) {
          rendition.next();
          await new Promise((r) => setTimeout(r, 60));
        }
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
            // block-level fallback (.tts-active) and the per-chunk span (.tts-chunk).
            const ttsHighlightCss = Object.entries(READER_THEMES)
              .flatMap(([name, theme]) => {
                const rules = theme.rules as unknown as Record<
                  string,
                  Record<string, string>
                >;
                return ([".tts-active", ".tts-chunk"] as const)
                  .filter((sel) => rules[sel])
                  .map((sel) => {
                    const declarations = Object.entries(rules[sel])
                      .map(([prop, value]) => `${prop}: ${value};`)
                      .join(" ");
                    return `.${name} ${sel} { ${declarations} }`;
                  });
              })
              .join("\n");

            rendition.hooks.content.register((contents: Contents) => {
              contents.addStylesheetCss(ttsHighlightCss, "br-tts-highlight");
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
