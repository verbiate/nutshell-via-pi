"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@teispace/next-themes";
import type { NavItem } from "@likecoin/epub-ts";
import { EpubViewer, type EpubViewerHandle } from "./epub-viewer";
import { READER_THEME_NAMES, type ReaderThemeName } from "./themes";
import { ReaderChrome } from "./reader-chrome";
import { TocPanel } from "./toc-panel";
import { ThemeToggle } from "./theme-toggle";
import { ReadingProgress } from "./reading-progress";
import { ReaderSkeleton } from "./reader-skeleton";
import { ReaderError } from "./reader-error";
import { FloatingToolbar } from "./floating-toolbar";
import { ReaderSidebar } from "./reader-sidebar";
import type { ReaderTool } from "./reader-tools";
import { SearchPanel } from "./search-panel";
import { BookmarkPanel } from "./bookmark-panel";
import { ExplainerPanel } from "@/components/explainer/explainer-panel";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { TtsTrigger } from "./tts-trigger";
import { TtsPlayer } from "./tts-player";
import { useTtsPlayback } from "@/hooks/use-tts-playback";
import { cn } from "@/lib/utils";

interface SavedPosition {
  paragraphIndex: number;
  charOffset: number;
  cfi?: string;
}

export interface ReaderClientProps {
  bookId: string;
  bookTitle?: string;
  epubUrl: string;
}

export function ReaderClient({ bookId, bookTitle, epubUrl }: ReaderClientProps) {
  const router = useRouter();
  const viewerRef = useRef<EpubViewerHandle>(null);
  // Wraps the EpubViewer; its width animates with the sidebar. We listen to
  // transitionend on this element to trigger epub.js re-pagination.
  const epubWrapperRef = useRef<HTMLDivElement>(null);
  // ponytail: epub.js renders in an iframe; keydown there doesn't bubble to window,
  // so we attach the same handler to the iframe's contentDocument and track it for cleanup.
  const iframeDocRef = useRef<Document | null>(null);
  const { user } = useSession();
  const { resolvedTheme } = useTheme();

  const readerTheme: ReaderThemeName = (
    READER_THEME_NAMES.includes(resolvedTheme as ReaderThemeName)
      ? resolvedTheme
      : "light"
  ) as ReaderThemeName;

  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentHref, setCurrentHref] = useState<string>("");
  const [percentage, setPercentage] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const initialLanguage = (user as any)?.preferredLanguage || "en";

  // ─── Selection / floating toolbar state ────────────────────────────────────────
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [toolbarPos, setToolbarPos] = useState({ top: 0, left: 0 });
  const [toolbarPlacement, setToolbarPlacement] = useState<"above" | "below">("above");
  const [selectedCfi, setSelectedCfi] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [passageExplainerOpen, setPassageExplainerOpen] = useState(false);
  const [currentCfi, setCurrentCfi] = useState<string | undefined>(undefined);
  const [activeTool, setActiveTool] = useState<ReaderTool["id"] | null>(null);

  // ─── Position state ────────────────────────────────────────────────────────────
  const [savedPosition, setSavedPosition] = useState<SavedPosition | null>(null);

  // Ref to hold the debounce timeout ID — cleared on unmount and before re-setting
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Highlights data (via React Query) ────────────────────────────────────────
  const { data: highlightsData } = useQuery({
    queryKey: ["highlights", bookId],
    queryFn: async () => {
      const res = await fetch(
        `/api/reader/highlights?bookId=${encodeURIComponent(bookId)}`
      );
      if (!res.ok) throw new Error("Failed to load highlights");
      return res.json();
    },
  });

  // ─── Load saved position on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadPosition() {
      try {
        const res = await fetch(
          `/api/reader/position?bookId=${encodeURIComponent(bookId)}`
        );
        if (!res.ok) {
          if (res.status === 404) return; // no position saved yet — normal
          console.warn("[ReaderClient] Failed to load position:", res.status);
          return;
        }
        const data = await res.json();
        if (!cancelled && data.position) {
          setSavedPosition({
            paragraphIndex: data.position.paragraphIndex,
            charOffset: data.position.charOffset,
            cfi: data.position.cfi ?? undefined,
          });
        }
      } catch (err) {
        // Non-blocking — log warning and continue without position restore
        console.warn(
          "[ReaderClient] Position fetch failed (non-blocking):",
          err
        );
      }
    }

    loadPosition();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // ─── Debounced save ──────────────────────────────────────────────────────────
  const savePosition = useCallback(
    async (position: SavedPosition) => {
      try {
        const res = await fetch("/api/reader/position", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookId,
            paragraphIndex: position.paragraphIndex,
            charOffset: position.charOffset,
            cfi: position.cfi,
          }),
        });
        if (!res.ok) {
          console.warn("[ReaderClient] Position save failed:", res.status);
        }
      } catch (err) {
        console.warn(
          "[ReaderClient] Position save failed (non-blocking):",
          err
        );
      }
    },
    [bookId]
  );

  // ─── Callbacks ───────────────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    router.push("/my-library");
  }, [router]);

  const handleRetry = useCallback(() => {
    setError(null);
    window.location.reload();
  }, []);

  const handleTocNavigate = useCallback(async (href: string) => {
    setCurrentHref(href);
    await viewerRef.current?.navigateTo(href);
  }, []);

  const handleTocLoaded = useCallback((loadedToc: NavItem[]) => {
    setToc(loadedToc);
  }, []);

  const handleProgressChange = useCallback((pct: number) => {
    setPercentage(pct);
  }, []);

  /**
   * Significant change = different paragraph index, or char offset differs by > 50.
   * Prevents spamming saves for tiny intra-paragraph adjustments.
   */
  const isSignificantChange = (
    prev: SavedPosition | null,
    next: SavedPosition
  ): boolean => {
    if (!prev) return true;
    if (prev.paragraphIndex !== next.paragraphIndex) return true;
    if (Math.abs(prev.charOffset - next.charOffset) > 50) return true;
    return false;
  };

  const handlePositionChange = useCallback(
    (position: { paragraphIndex: number; charOffset: number }, cfi: string) => {
      const next: SavedPosition = {
        paragraphIndex: position.paragraphIndex,
        charOffset: position.charOffset,
        cfi,
      };

      // Track current CFI for bookmark creation
      setCurrentCfi(cfi);

      // Update local state
      setSavedPosition(next);

      // Debounce: clear any pending save, schedule a new one in 3 seconds
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Only fire if the change is significant
      setSavedPosition((prev) => {
        if (!isSignificantChange(prev, next)) return prev;

        saveTimeoutRef.current = setTimeout(() => {
          savePosition(next);
        }, 3000);

        return next;
      });
    },
    [savePosition]
  );

  // ─── Text selection handling ──────────────────────────────────────────────────
  const handleTextSelected = useCallback(
    (cfiRange: string, contents: unknown) => {
      const c = contents as { document?: Document; range?: unknown };

      // epub-ts can fire 'selected' during arrow-key navigation with a
      // synthetic range object that lacks DOM methods. Duck-type a real Range.
      const range =
        c.range &&
        typeof (c.range as Range).getBoundingClientRect === "function" &&
        typeof (c.range as Range).toString === "function"
          ? (c.range as Range)
          : null;

      if (!range) return;

      const text = range.toString();
      if (text.length < 3) return;

      setSelectedCfi(cfiRange);
      setSelectedText(text);

      // Compute position from iframe
      const iframe = document.querySelector("iframe");
      if (iframe) {
        const rect = range.getBoundingClientRect();
        const iframeRect = iframe.getBoundingClientRect();
        const toolbarWidth = 220;
        const toolbarHeight = 36;
        let top = iframeRect.top + rect.top - toolbarHeight - 8;
        let placement: "above" | "below" = "above";
        if (top < toolbarHeight + 16) {
          top = iframeRect.top + rect.bottom + 8;
          placement = "below";
        }
        let left =
          iframeRect.left + rect.left + rect.width / 2 - toolbarWidth / 2;
        left = Math.max(
          8,
          Math.min(left, window.innerWidth - toolbarWidth - 8)
        );
        setToolbarPos({ top, left });
        setToolbarPlacement(placement);
        setToolbarVisible(true);
      }
    },
    []
  );

  const handleSelectionCleared = useCallback(() => {
    setToolbarVisible(false);
    setSelectedCfi(null);
    setSelectedText("");
  }, []);

  // ─── Floating toolbar actions ────────────────────────────────────────────────
  const handleHighlight = useCallback(async () => {
    if (!selectedCfi) return;
    try {
      const res = await fetch("/api/reader/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          cfi: selectedCfi,
          paragraphIndex: savedPosition?.paragraphIndex ?? 0,
          charOffsetStart: savedPosition?.charOffset ?? 0,
          charOffsetEnd: (savedPosition?.charOffset ?? 0) + selectedText.length,
          selectedText,
        }),
      });
      if (res.ok) {
        toast.success("Text highlighted");
        viewerRef.current?.addHighlight(selectedCfi, "#fbbf24");
      }
    } catch (err) {
      console.error("[ReaderClient] highlight failed:", err);
    }
    setToolbarVisible(false);
  }, [bookId, selectedCfi, selectedText, savedPosition]);

  const handleExplainPassage = useCallback(() => {
    setToolbarVisible(false);
    setPassageExplainerOpen(true);
  }, []);

  // ─── Search navigation ────────────────────────────────────────────────────────
  const handleSearchResult = useCallback((paragraphIndex: number) => {
    viewerRef.current?.navigateToParagraph(paragraphIndex);
  }, []);

  // ─── Bookmark actions ──────────────────────────────────────────────────────────
  const handleBookmarkNavigate = useCallback((cfi: string) => {
    viewerRef.current?.navigateTo(cfi);
  }, []);

  const handleSaveBookmark = useCallback(
    async (cfi: string) => {
      try {
        const res = await fetch("/api/reader/bookmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookId,
            cfi,
            paragraphIndex: savedPosition?.paragraphIndex ?? 0,
            charOffset: savedPosition?.charOffset ?? 0,
            selectedText: null,
          }),
        });
        if (res.ok) toast.success("Bookmark saved");
      } catch (err) {
        console.error("[ReaderClient] bookmark save failed:", err);
      }
    },
    [bookId, savedPosition]
  );

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore when typing in an input/textarea/contenteditable
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    // Don't intercept if modifier keys are held (let browser shortcuts work)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      viewerRef.current?.next().catch((err) => console.error("[Reader] next() error:", err));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      viewerRef.current?.prev().catch((err) => console.error("[Reader] prev() error:", err));
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Clean up the iframe keydown listener on unmount
  useEffect(() => {
    return () => {
      iframeDocRef.current?.removeEventListener("keydown", handleKeyDown);
      iframeDocRef.current = null;
    };
  }, [handleKeyDown]);

  // ─── Render highlights when rendition is ready ─────────────────────────────────
  const handleRenditionReady = useCallback(
    (rendition: unknown) => {
      setIsLoaded(true);

      // Attach keydown to the epub iframe document — events inside the iframe
      // don't bubble to the parent window. 'rendered' fires on every chapter swap
      // (epub.js swaps the iframe per section), so we re-attach each time.
      const attachToDoc = (doc: Document | null | undefined) => {
        if (!doc) return;
        iframeDocRef.current?.removeEventListener("keydown", handleKeyDown);
        doc.addEventListener("keydown", handleKeyDown);
        iframeDocRef.current = doc;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = rendition as any;
      attachToDoc(r?.contents?.document);
      r?.on?.("rendered", (_section: unknown, contents: { document: Document }) => {
        attachToDoc(contents.document);
      });

      if (highlightsData?.highlights) {
        highlightsData.highlights.forEach(
          (h: { cfi: string; color?: string }) => {
            viewerRef.current?.addHighlight(h.cfi, h.color);
          }
        );
      }
    },
    [highlightsData, handleKeyDown]
  );

  const handleError = useCallback((err: Error) => {
    setError(err);
  }, []);

  // ─── Click-outside to dismiss floating toolbar ─────────────────────────────────
  useEffect(() => {
    if (!toolbarVisible) return;
    const handleClick = (e: MouseEvent) => {
      // If click is not inside the toolbar, hide it
      const toolbarEl = document.querySelector('[role="toolbar"]');
      if (toolbarEl && !toolbarEl.contains(e.target as Node)) {
        setToolbarVisible(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [toolbarVisible]);

  // ─── Cleanup: clear pending saves on unmount ──────────────────────────────────
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, []);
  // ─── TTS Playback ──────────────────────────────────────────────────────────
  const handleTtsNavigate = useCallback((href: string) => {
    setCurrentHref(href);
    viewerRef.current?.navigateTo(href);
  }, []);

  const tts = useTtsPlayback({
    bookId,
    toc,
    currentHref,
    onNavigateToSection: handleTtsNavigate,
  });

  // ─── Sidebar ↔ epub.js resize choreography ─────────────────────────────────
  // The EpubViewer wrapper animates its width when the sidebar opens/closes.
  // Once the width settles, tell epub.js to re-measure its container and
  // re-paginate. Fires on both open (narrow) and close (widen).
  useEffect(() => {
    const el = epubWrapperRef.current;
    if (!el) return;
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "width") return;
      viewerRef.current?.resize();
    };
    el.addEventListener("transitionend", onEnd);
    return () => el.removeEventListener("transitionend", onEnd);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      data-sidebar-open={activeTool ? "true" : "false"}
      className={cn("relative h-full w-full", tts.state.state !== "IDLE" && "pb-16")}
    >
      {/* Hidden audio element for TTS playback */}
      <audio ref={tts.audioRef} className="hidden" />

      {/* Error overlay */}
      {error && <ReaderError onBack={handleBack} onRetry={handleRetry} />}

      {/* EPUB viewer — wrapped in a width-animating layer (Layer 1).
          When the sidebar opens this div narrows by --reader-sidebar-w,
          revealing the sidebar (z-20) underneath. The right-edge box-shadow
          is constant; it's only visible once the wrapper moves off the
          viewport's right edge (i.e., when the sidebar is open). */}
      {!error && (
        <div
          ref={epubWrapperRef}
          className={cn(
            "relative z-30 h-full w-full overflow-hidden bg-background transition-[width] duration-[var(--reader-dur)] ease-reader",
            "[box-shadow:12px_0_18px_-12px_rgba(43,28,17,0.35)]",
            activeTool && "w-[calc(100%-var(--reader-sidebar-w)-var(--reader-rail-w))]",
          )}
        >
          <EpubViewer
            ref={viewerRef}
            url={epubUrl}
            theme={readerTheme}
            initialCfi={savedPosition?.cfi ?? null}
            initialPosition={
              savedPosition && !savedPosition.cfi ? savedPosition : null
            }
            onTocLoaded={handleTocLoaded}
            onProgressChange={handleProgressChange}
            onPositionChange={handlePositionChange}
            onRenditionReady={handleRenditionReady}
            onError={handleError}
            onLoadChange={(loaded) => setIsLoaded(loaded)}
            onTextSelected={handleTextSelected}
            onSelectionCleared={handleSelectionCleared}
            className="h-full w-full"
          />
        </div>
      )}

      {/* Floating toolbar for text selection */}
      <FloatingToolbar
        visible={toolbarVisible}
        position={toolbarPos}
        placement={toolbarPlacement}
        onHighlight={handleHighlight}
        onExplain={handleExplainPassage}
        onDismiss={handleSelectionCleared}
      />

      {/* Passage-level Explainer */}
      <ExplainerPanel
        open={passageExplainerOpen}
        onOpenChange={setPassageExplainerOpen}
        bookId={bookId}
        type="passage"
        sectionTitle="Selected Passage"
        initialLanguage={initialLanguage}
        passageText={selectedText}
      />

      {/* Loading skeleton overlay */}
      {!isLoaded && !error && <ReaderSkeleton />}

      {/* Reader chrome — only shown once loaded and no error */}
      {isLoaded && !error && (
        <>
          <ReaderChrome
            bookTitle={bookTitle ?? "Loading..."}
            onBack={handleBack}
            sidebarOpen={activeTool !== null}
            tocTrigger={
              <TocPanel
                toc={toc}
                currentHref={currentHref}
                onNavigate={handleTocNavigate}
                bookId={bookId}
                initialLanguage={initialLanguage}
              />
            }
            themeToggle={<ThemeToggle />}
            bookmarkSaveTrigger={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => currentCfi && handleSaveBookmark(currentCfi)}
                aria-label="Save bookmark"
              >
                <Bookmark className="h-4 w-4" />
              </Button>
            }
            bookmarkTrigger={
              <BookmarkPanel
                bookId={bookId}
                currentCfi={currentCfi}
                onBookmarkClick={handleBookmarkNavigate}
                onSaveBookmark={handleSaveBookmark}
              />
            }
            searchTrigger={
              <SearchPanel
                bookId={bookId}
                onResultClick={handleSearchResult}
              />
            }
            ttsTrigger={
              <TtsTrigger
                state={
                  tts.state.state === "GENERATING"
                    ? "generating"
                    : tts.state.state === "IDLE"
                    ? "idle"
                    : "disabled"
                }
                onClick={() => {
                  if (tts.state.state === "IDLE") {
                    const currentSection = toc.find((item) => item.href === currentHref);
                    tts.startSection(currentHref, currentSection?.label || "Reading");
                  } else {
                    tts.togglePlayPause();
                  }
                }}
              />
            }
          />
          <ReadingProgress percentage={percentage} sidebarOpen={activeTool !== null} />
          <ReaderSidebar
            activeTool={activeTool}
            onToolClick={(id) =>
              setActiveTool((prev) => (prev === id ? null : id))
            }
          />
        </>
      )}

      {/* TTS audio player — outside the isLoaded check so it persists independently */}
      <TtsPlayer
        state={tts.state}
        onPlayPause={tts.togglePlayPause}
        onScrub={tts.scrub}
        onClose={tts.close}
      />
    </div>
  );
}
