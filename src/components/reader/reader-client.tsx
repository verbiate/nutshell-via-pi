"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { useTheme } from "@teispace/next-themes";
import type { NavItem } from "@likecoin/epub-ts";
import { EpubViewer, type EpubViewerHandle } from "./epub-viewer";
import { READER_THEME_NAMES, type ReaderThemeName } from "./themes";
import { ReaderChrome } from "./reader-chrome";
import { ReadingProgress } from "./reading-progress";
import { ReaderSkeleton } from "./reader-skeleton";
import { ReaderError } from "./reader-error";
import { backToLibrary } from "./back-nav";
import { useSceneTransition } from "@/components/transitions/scene-transition";
import { FloatingToolbar } from "./floating-toolbar";
import { ReaderSidebar } from "./reader-sidebar";
import { ReaderPanel } from "./reader-panel";
import { BookmarksPanel } from "./bookmarks-panel";
import { HighlightsPanel } from "./highlights-panel";
import type { ReaderTool } from "./reader-tools";
import { SearchPanel } from "./search-panel";
import {
  BookSettingsPanel,
  DEFAULT_BOOK_SETTINGS,
  SERIF_STACK,
  SANS_STACK,
  type BookSettings,
} from "./book-settings-panel";
import { ExplainerPanel } from "@/components/explainer/explainer-panel";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { TtsTrigger } from "./tts-trigger";
import { TtsPlayer } from "./tts-player";
import { useTtsPlayback } from "@/hooks/use-tts-playback";
import { cn } from "@/lib/utils";

interface SavedPosition {
  paragraphIndex: number;
  charOffset: number;
  cfi?: string;
  percentage?: number;
}

// ponytail: temporary stand-in for sidebar sections not yet built.
function SidebarPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex min-h-[120px] flex-col gap-2 px-5 py-4">
      {[0, 1, 2].map((i) => (
        <p
          key={i}
          className="text-sm leading-relaxed text-muted-foreground"
        >
          {label}
        </p>
      ))}
    </div>
  );
}

export interface ReaderClientProps {
  bookId: string;
  bookTitle?: string;
  bookAuthor?: string | null;
  bookCoverPath?: string | null;
  bookLanguage?: string;
  epubUrl: string;
  isAdmin?: boolean;
  bookCreatedAt?: string;
}

export function ReaderClient({
  bookId,
  bookTitle,
  bookAuthor,
  bookCoverPath,
  bookLanguage,
  epubUrl,
  isAdmin,
  bookCreatedAt,
}: ReaderClientProps) {
  const { navigate: sceneNavigate, entering, forwardFlyActive } = useSceneTransition();
  const viewerRef = useRef<EpubViewerHandle>(null);
  // Wraps the EpubViewer; its width animates with the sidebar. We listen to
  // transitionend on this element to trigger epub.js re-pagination.
  const epubWrapperRef = useRef<HTMLDivElement>(null);
  // ponytail: epub.js renders in an iframe; keydown there doesn't bubble to window,
  // so we attach the same handler to the iframe's contentDocument and track it for cleanup.
  const iframeDocRef = useRef<Document | null>(null);
  const { user } = useSession();
  const { resolvedTheme, setTheme } = useTheme();

  const readerTheme: ReaderThemeName = (
    READER_THEME_NAMES.includes(resolvedTheme as ReaderThemeName)
      ? resolvedTheme
      : "light"
  ) as ReaderThemeName;

  // ponytail: current-book-only settings; no persistence yet (per spec).
  const [bookSettings, setBookSettings] = useState<BookSettings>(
    DEFAULT_BOOK_SETTINGS,
  );
  const handleSettingsChange = useCallback((patch: Partial<BookSettings>) => {
    setBookSettings((s) => ({ ...s, ...patch }));
  }, []);
  const handleThemeChange = useCallback(
    (t: ReaderThemeName) => setTheme(t),
    [setTheme],
  );

  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentHref, setCurrentHref] = useState<string>("");
  const [percentage, setPercentage] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const initialLanguage = (user as any)?.preferredLanguage || "en";

  // ─── Selection / floating toolbar state ────────────────────────────────────────
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [toolbarPos, setToolbarPos] = useState({ top: 0, left: 0 });
  const [selectedCfi, setSelectedCfi] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [passageExplainerOpen, setPassageExplainerOpen] = useState(false);
  const [currentCfi, setCurrentCfi] = useState<string | undefined>(undefined);
  const [activeTool, setActiveTool] = useState<ReaderTool["id"] | null>(null);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);

  // ─── Position state ────────────────────────────────────────────────────────────
  const [savedPosition, setSavedPosition] = useState<SavedPosition | null>(null);

  // Ref to hold the debounce timeout ID — cleared on unmount and before re-setting
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Most recent position; read by flush helpers on unmount / tab hide so the
  // latest page is not lost when the 3s debounce hasn't fired yet.
  const lastPositionRef = useRef<SavedPosition | null>(null);

  // ─── Highlights data (via React Query) ────────────────────────────────────────
  const queryClient = useQueryClient();
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
      console.log("[ReaderClient] savePosition called with:", position);
      try {
        const res = await fetch("/api/reader/position", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookId,
            paragraphIndex: position.paragraphIndex,
            charOffset: position.charOffset,
            cfi: position.cfi,
            percentage: position.percentage,
          }),
        });
        console.log("[ReaderClient] savePosition response:", res.status, await res.text());
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

  // Flush a pending (unsaved) position immediately — used on unmount and tab
  // hide so the latest page isn't lost if the debounce timer hasn't fired yet.
  // Returns the save promise (or undefined when nothing is pending) so callers
  // that need the position persisted before navigating can await it.
  const flushPendingSave = useCallback((): Promise<void> | undefined => {
    if (saveTimeoutRef.current && lastPositionRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
      return savePosition(lastPositionRef.current);
    }
    return undefined;
  }, [savePosition]);

  // ─── Callbacks ───────────────────────────────────────────────────────────────
  const handleBack = useCallback(async () => {
    // ponytail: persist the latest reading position BEFORE the back transition
    // starts. The reader otherwise flushes on unmount (at router.push, ~0.8s in)
    // which races the shelf's router.refresh() GET and can leave the just-read
    // book outside slot 0 (recency). Awaiting here gives the save the whole
    // slide-out to commit; it's a no-op when nothing is pending (the common
    // case, since positions also debounce-save every 3s while reading).
    await flushPendingSave();
    // ponytail: capture the sidebar cover clone BEFORE the reader slides out so
    // the back fly has a stable origin. If a forward fly is still inbound (user
    // backed during the slide-in), the real cover is mid-transition — treat as
    // sidebar-closed (no back fly) rather than capture a half-state cover.
    const sidebarOpen = activeTool !== null && !forwardFlyActive;
    let hero: { node: HTMLElement; rect: DOMRect } | undefined;
    if (sidebarOpen) {
      const el = document.querySelector(
        "[data-hero-cover]",
      ) as HTMLElement | null;
      if (el && el.getBoundingClientRect) {
        hero = {
          node: el.cloneNode(true) as HTMLElement,
          rect: el.getBoundingClientRect(),
        };
      }
    }
    backToLibrary(sceneNavigate, { hero, bookId, sidebarOpen });
  }, [flushPendingSave, activeTool, bookId, forwardFlyActive, sceneNavigate]);

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

  // ponytail: debounce save per CFI change (3s). No significance gate — the
  // paragraph/offset payload from the viewer is a placeholder; percentage is the
  // meaningful progress signal. Clearing + rescheduling coalesces rapid page
  // moves into one write.
  const handlePositionChange = useCallback(
    (
      position: { paragraphIndex: number; charOffset: number },
      cfi: string,
      percentage: number
    ) => {
      const next: SavedPosition = {
        paragraphIndex: position.paragraphIndex,
        charOffset: position.charOffset,
        cfi,
        percentage,
      };
      setCurrentCfi(cfi);
      lastPositionRef.current = next;
      setSavedPosition(next);

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => savePosition(next), 3000);
    },
    [savePosition]
  );

  // ─── Text selection handling ──────────────────────────────────────────────────
  const handleTextSelected = useCallback(
    (cfiRange: string, contents: unknown) => {
      // epub-ts passes its Contents instance (the iframe's window/document),
      // NOT a range. Pull the live selection Range out of the iframe window.
      const c = contents as { window?: Window; document?: Document };
      const win = c.window;
      const selection = win?.getSelection?.() ?? null;
      const range =
        selection && selection.rangeCount > 0
          ? selection.getRangeAt(0)
          : null;

      // Duck-type a real Range with DOM methods (synthetic ranges lack them).
      const realRange =
        range &&
        typeof range.getBoundingClientRect === "function" &&
        typeof range.toString === "function"
          ? range
          : null;

      if (!realRange) return;

      const text = realRange.toString();
      if (text.length < 3) return;

      setSelectedCfi(cfiRange);
      setSelectedText(text);

      // Compute position from iframe.
      // ponytail: menu is now ~168px tall / 220px wide; keep it inside the
      // viewport so it never renders completely off-screen.
      const iframe = document.querySelector("iframe");
      if (iframe) {
        const rect = realRange.getBoundingClientRect();
        const iframeRect = iframe.getBoundingClientRect();
        const toolbarWidth = 220;
        const toolbarHeight = 168;
        let top = iframeRect.top + rect.top - toolbarHeight - 8;
        if (top < toolbarHeight + 16) {
          top = iframeRect.top + rect.bottom + 8;
        }
        top = Math.max(8, top);
        top = Math.min(top, window.innerHeight - toolbarHeight - 8);
        let left =
          iframeRect.left + rect.left + rect.width / 2 - toolbarWidth / 2;
        left = Math.max(
          8,
          Math.min(left, window.innerWidth - toolbarWidth - 8)
        );
        setToolbarPos({ top, left });
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
  const handleHighlight = useCallback(
    async (color: string) => {
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
            color,
            sectionHref: currentHref || undefined,
          }),
        });
        if (res.ok) {
          toast.success("Text highlighted");
          viewerRef.current?.addHighlight(selectedCfi, color);
          void queryClient.invalidateQueries({ queryKey: ["highlights", bookId] });
        } else {
          toast.error("Highlight failed");
        }
      } catch (err) {
        console.error("[ReaderClient] highlight failed:", err);
      }
      setToolbarVisible(false);
    },
    [bookId, selectedCfi, selectedText, savedPosition, currentHref, queryClient]
  );

  const handleExplainPassage = useCallback(() => {
    setToolbarVisible(false);
    setPassageExplainerOpen(true);
  }, []);

  // ─── Search navigation ────────────────────────────────────────────────────────
  const handleSearchResult = useCallback((paragraphIndex: number) => {
    viewerRef.current?.navigateToParagraph(paragraphIndex);
  }, []);

  // ─── Bookmark actions ──────────────────────────────────────────────────────────
  // ponytail: generic CFI navigator — shared by bookmarks and highlights panels.
  const handleNavigateToCfi = useCallback((cfi: string) => {
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
            sectionHref: currentHref || undefined,
          }),
        });
        if (res.ok) toast.success("Bookmark saved");
      } catch (err) {
        console.error("[ReaderClient] bookmark save failed:", err);
      }
    },
    [bookId, savedPosition, currentHref]
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
          (h: { cfi: string; color: string }) => {
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
      // ponytail: query the data attr, not [role=toolbar] — the sidebar rail
      // also has role=toolbar and would shadow this lookup.
      const toolbarEl = document.querySelector("[data-floating-toolbar]");
      if (toolbarEl && !toolbarEl.contains(e.target as Node)) {
        setToolbarVisible(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [toolbarVisible]);

  // ─── Flush unsaved position on unmount and when the tab is hidden ──────────────
  useEffect(() => {
    // ponytail: void the promise — useEffect cleanup must return void/undefined,
    // not a Promise. Fire-and-forget is correct here (nothing to await on unmount).
    return () => {
      void flushPendingSave();
    };
  }, [flushPendingSave]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushPendingSave();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flushPendingSave]);
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

  // ponytail: mirrors the chrome TtsTrigger onClick — same action, second entry point.
  const handleListenFromHere = useCallback(() => {
    if (tts.state.state === "IDLE") {
      const section = toc.find((item) => item.href === currentHref);
      tts.startSection(currentHref, section?.label || "Reading");
    } else {
      tts.togglePlayPause();
    }
  }, [tts, toc, currentHref]);

  // Derive EPUB typography overrides from settings. Memoized so the EpubViewer
  // effect only fires on actual change. Publisher font = omit font-family so the
  // book's embedded font shows through.
  const typography = useMemo<Record<string, string>>(() => {
    const o: Record<string, string> = {
      "font-size": `${bookSettings.fontSize}px`,
      "line-height": String(bookSettings.lineSpacing),
      "text-align": bookSettings.alignment,
      hyphens: bookSettings.alignment === "justify" ? "auto" : "manual",
    };
    if (bookSettings.fontFamily === "serif") o["font-family"] = SERIF_STACK;
    else if (bookSettings.fontFamily === "sans") o["font-family"] = SANS_STACK;
    return o;
  }, [bookSettings.fontSize, bookSettings.lineSpacing, bookSettings.alignment, bookSettings.fontFamily]);

  // Apply TTS playback speed to the audio element whenever it changes or a new
  // section loads. ponytail: audio.playbackRate is live-adjustable, no reload.
  useEffect(() => {
    if (tts.audioRef.current) {
      tts.audioRef.current.playbackRate = bookSettings.voiceSpeed;
    }
  }, [bookSettings.voiceSpeed, tts.audioRef, tts.state.state]);

  // ─── Sidebar ↔ epub.js resize choreography ─────────────────────────────────
  // The EpubViewer wrapper animates its width when the sidebar opens/closes.
  // During the transition, the book fades to low opacity so the epub.js reflow
  // snap at the end is hidden behind the dip. Once the width settles, we tell
  // epub.js to re-measure and re-paginate, then restore full opacity.
  // ponytail: track sidebar open/close for the epub re-pagination dip — but
  // only after the book is loaded, so the entry-time open (sidebar opens during
  // the slide-in, before isLoaded) doesn't fire a spurious opacity dip on the
  // not-yet-mounted EpubViewer.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    const isOpen = activeTool !== null;
    if (prevOpenRef.current !== isOpen) {
      prevOpenRef.current = isOpen;
      if (isLoaded) setSidebarAnimating(true);
    }
  }, [activeTool, isLoaded]);

  useEffect(() => {
    const el = epubWrapperRef.current;
    if (!el) return;
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "width") return;
      viewerRef.current?.resize();
      setSidebarAnimating(false);
    };
    el.addEventListener("transitionend", onEnd);
    return () => el.removeEventListener("transitionend", onEnd);
  }, []);

  // ─── Entry: open the book-details sidebar as the slide-in starts ────────────
  // The sidebar mounts closed; opening it here (entering flips true on reader
  // arrival) runs its open transition concurrently with the slide-in. The root
  // --reader-dur override (see render) stretches that transition to match the
  // slide-in, so the sidebar finishes opening just as the reader settles — one
  // fluid motion (shelf → sidebar opening → cover lands). isLoaded is a fallback
  // for when entering never fires (reduced motion skips the slide-in; direct
  // URL nav has no scene transition). Functional update so a user who closed it
  // during the slide-in isn't overridden.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!entering && !isLoaded) return;
    autoOpenedRef.current = true;
    setActiveTool((prev) => prev ?? "reader");
  }, [entering, isLoaded]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      data-sidebar-open={activeTool ? "true" : "false"}
      className={cn("relative h-full w-full", tts.state.state !== "IDLE" && "pb-16")}
      // ponytail: stage the sidebar open to finish with the 0.8s slide-in.
      // --reader-delay (300ms) holds the sidebar closed while the reader gets a
      // head start; --reader-dur (500ms) is the open itself. 300 + 500 = 800ms,
      // so the sidebar lands exactly as the slide-in settles. Both revert to the
      // :root defaults (250ms / 0ms; 1ms under reduced motion) once entry is done
      // — normal open/close stays snappy and immediate.
      style={{
        "--reader-dur": entering ? "500ms" : undefined,
        "--reader-delay": entering ? "300ms" : "0ms",
      } as React.CSSProperties}
    >
      {/* Hidden audio element for TTS playback */}
      <audio ref={tts.audioRef} className="hidden" />

      {/* Error overlay */}
      {error && <ReaderError onBack={handleBack} onRetry={handleRetry} />}

      {/* EPUB viewer — wrapped in a width-animating layer (Layer 1).
           When the sidebar opens this div narrows by --reader-sidebar-w +
           --reader-rail-w, revealing the sidebar (z-20) underneath. Its box-shadow
           stays opaque throughout; only the inner content fades to 0 during the
           transition so the epub.js reflow snap at the end is hidden, then fades
           back in once resize() fires. */}
      {!error && (
        <div
          ref={epubWrapperRef}
          className="relative z-30 h-full w-full overflow-hidden bg-background"
          style={{
            width: activeTool
              ? "calc(100% - var(--reader-sidebar-w) - var(--reader-rail-w))"
              : "100%",
            boxShadow: "12px 0 18px -12px rgba(34,24,5,0.35)",
            transitionProperty: "width",
            transitionDuration: "var(--reader-dur)",
            transitionDelay: "var(--reader-delay, 0ms)",
            transitionTimingFunction: "cubic-bezier(.5, 0, .2, 1)",
          }}
        >
          {/* ponytail: book-contents placeholder — lives INSIDE the epub wrapper
              (not a full-screen overlay) so it's clipped to the book area, narrows
              with the wrapper as the sidebar opens, and leaves the sidebar + rail
              visible during entry. That makes the sidebar's open animation (which
              already runs concurrently with the slide-in via --reader-dur) visible
              instead of hidden behind an opaque z-60 layer until isLoaded. */}
          {!isLoaded && <ReaderSkeleton />}
          <div
            className="h-full w-full"
            style={{
              opacity: sidebarAnimating ? 0 : 1,
              transitionProperty: "opacity",
              transitionDuration: "150ms",
              transitionTimingFunction: "cubic-bezier(.5, 0, .2, 1)",
            }}
          >
          {/* ponytail: defer the iframe-bearing EpubViewer until the forward
              slide-in settles (entering===false). During the slide-in only the
              cheap ReaderSkeleton paints, so the animation isn't fighting the
              EPUB fetch/parse/iframe-render on the main thread + compositor. */}
          {!entering && (
            <EpubViewer
              ref={viewerRef}
              url={epubUrl}
              theme={readerTheme}
              typography={typography}
              initialCfi={savedPosition?.cfi ?? null}
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
          )}
          </div>
        </div>
      )}

      {/* Floating toolbar for text selection */}
      <FloatingToolbar
        visible={toolbarVisible}
        position={toolbarPos}
        selectedText={selectedText}
        onHighlight={handleHighlight}
        onAsk={handleExplainPassage}
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

      {/* Reader chrome + reading progress — only shown once loaded and no error */}
      {isLoaded && !error && (
        <>
          <ReaderChrome
            onBack={handleBack}
            sidebarOpen={activeTool !== null}
            onHideControls={() => setActiveTool(null)}
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
                onClick={handleListenFromHere}
              />
            }
          />
          <ReadingProgress percentage={percentage} sidebarOpen={activeTool !== null} />
        </>
      )}

      {/*
        Reader sidebar — rendered on mount (NOT gated by isLoaded) so it can
        open during the slide-in. ReaderPanel already guards the TOC
        (toc.length > 0), so the cover + action buttons show immediately and the
        TOC fills when the book loads. coverHidden holds the cover empty while a
        forward fly is inbound, then reveals it at the landing handoff.
      */}
      {!error && (
        <ReaderSidebar
          activeTool={activeTool}
          onToolClick={(id) =>
            setActiveTool((prev) => (prev === id ? null : id))
          }
          panels={{
            reader: (
              <ReaderPanel
                bookId={bookId}
                bookTitle={bookTitle ?? ""}
                author={bookAuthor}
                coverPath={bookCoverPath}
                language={bookLanguage}
                toc={toc}
                currentHref={currentHref}
                onNavigate={handleTocNavigate}
                initialLanguage={initialLanguage}
                onListenFromHere={handleListenFromHere}
                isAdmin={isAdmin}
                bookCreatedAt={bookCreatedAt}
                coverHidden={forwardFlyActive}
              />
            ),
            bookmark: (
              <BookmarksPanel
                bookId={bookId}
                currentCfi={currentCfi}
                toc={toc}
                onBookmarkClick={handleNavigateToCfi}
                onSaveBookmark={handleSaveBookmark}
              />
            ),
            pen: (
              <HighlightsPanel
                bookId={bookId}
                toc={toc}
                onHighlightClick={handleNavigateToCfi}
              />
            ),
            bulb: <SidebarPlaceholder label="Explainers" />,
            type: (
              <BookSettingsPanel
                theme={readerTheme}
                onThemeChange={handleThemeChange}
                settings={bookSettings}
                onChange={handleSettingsChange}
              />
            ),
          }}
        />
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
