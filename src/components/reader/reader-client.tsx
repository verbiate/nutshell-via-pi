"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
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
import { BookshelfSnapshot } from "@/components/transitions/bookshelf-snapshot";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
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
import { ExplainerThreadsPanel, type PendingExplainerRequest } from "@/components/explainer/explainer-threads-panel";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { TtsTrigger } from "./tts-trigger";
import { TtsPlayer } from "./tts-player";
import type { TtsPlaybackState } from "@/hooks/use-tts-playback";
import { useTtsEngine } from "@/hooks/use-tts-engine";
import { useTtsCloud, type CloudQuota } from "@/hooks/use-tts-cloud";
import { defaultEngineForLanguage, engineSupportsLanguage, type EngineId } from "@/lib/tts/languages";
import { ENGINES } from "@/lib/tts/engines";
import { loadTtsPref, saveTtsPref } from "@/lib/tts/pref";
import { cn } from "@/lib/utils";
import { shouldDisplayProgress } from "@/lib/reader/progress";
import type { LibraryBook, UserRole } from "@/types/book";

interface SavedPosition {
  paragraphIndex: number;
  charOffset: number;
  cfi?: string;
  percentage?: number;
}

export interface ReaderClientProps {
  bookId: string;
  bookTitle?: string;
  bookAuthor?: string | null;
  bookCoverPath?: string | null;
  bookLanguage?: string;
  bookDescription?: string | null;
  epubUrl: string;
  isAdmin?: boolean;
  bookCreatedAt?: string;
  // ponytail: initial library snapshot for BookshelfSnapshot — the back-nav
  // fallback when the user deep-linked/refreshed (no forward nav captured a
  // library clone). Re-fetched on back-click for fresh recency order.
  librarySnapshot: LibraryBook[];
  libraryUserName: string | null;
  libraryDigestImage: string | null;
  // ponytail: token budget inputs for the Explainer's "X% full" indicator.
  // bookTxtTokens is the dominant term (full book plaintext re-sent on every
  // follow-up); null = lazy backfill pending (Playground shows "+ pending").
  // contextWindow is the user's CURRENT tier model's window, resolved server-
  // side via getOpenRouterConfig + getContextWindow.
  bookTxtTokens?: number | null;
  contextWindow?: number;
}

export function ReaderClient({
  bookId,
  bookTitle,
  bookAuthor,
  bookCoverPath,
  bookLanguage,
  bookDescription,
  epubUrl,
  isAdmin,
  bookCreatedAt,
  librarySnapshot: initialLibrary,
  libraryUserName,
  libraryDigestImage,
  bookTxtTokens,
  contextWindow,
}: ReaderClientProps) {
  const { navigate: sceneNavigate, entering, forwardFlyActive } = useSceneTransition();
  // ponytail: mutable library snapshot state — updated synchronously on
  // back-click via flushSync before backToLibrary fires, so the snapshot clone
  // in [data-scene-clone] reflects post-read recency order at animation time.
  const [librarySnapshot, setLibrarySnapshot] =
    useState<LibraryBook[]>(initialLibrary);
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
  const reducedMotion = usePrefersReducedMotion();
  // ponytail: latches true once the page-content reveal fade completes, so the
  // skeleton unmounts. Resets per mount (reader-client remounts per book).
  const [contentRevealed, setContentRevealed] = useState(false);

  // ponytail: direction-aware wobble filter for the progress bar. Diagnostic
  // trace on Creativity, Inc. showed epub.js fires `relocated` 2–3× per page
  // turn (post-display, SCROLLED, RESIZED) and the rAF measurement can briefly
  // land on an adjacent page in the WRONG direction during the transition —
  // forward nav emits a transient 45 while settling at 46; backward nav emits
  // a transient 46 while settling at 45. High-water mark couldn't tell those
  // apart from real movement. Direction tag from the user's last explicit
  // next/prev + a 500 ms window does: reject opposite-direction movement
  // inside the window, accept everything else (TOC/search/bookmark jumps pass
  // through with dir=null).
  // ponytail: ceiling — same-direction overshoot (46→47→46 settling) still
  // briefly shows. Acceptable; rare and small. Upgrade path: track expected
  // delta per action.
  const displayedPctRef = useRef(0);
  const lastActionDirRef = useRef<"forward" | "backward" | null>(null);
  const lastActionTimeRef = useRef(0);

  const initialLanguage = (user as any)?.preferredLanguage || "en";

  // ─── Selection / floating toolbar state ────────────────────────────────────────
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [toolbarPos, setToolbarPos] = useState({ top: 0, left: 0 });
  const [selectedCfi, setSelectedCfi] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  // ponytail: auto-hide chrome (top bar + progress) when the sidebar is closed
  // and the pointer is idle. pointermove covers mouse + touch + pen. Ceiling: a
  // touch tap with no drag won't re-show (no pointermove fires); upgrade path is
  // also listening for pointerdown. TtsPlayer and FloatingToolbar stay visible.
  const [pointerActive, setPointerActive] = useState(true);
  const pointerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ponytail: pendingRequest communicates any "ask about" click (floating
  // toolbar passage, ToC dropdown section, "Ask the book" button) from the
  // reader to the ExplainerThreadsPanel in the sidebar. The panel consumes
  // it (fires the create-thread API) and calls onConsumed to clear it.
  const [pendingRequest, setPendingRequest] = useState<PendingExplainerRequest | null>(null);
  const [currentCfi, setCurrentCfi] = useState<string | undefined>(undefined);
  const [activeTool, setActiveTool] = useState<ReaderTool["id"] | null>(null);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);

  // ─── Book description (LLM-extracted, may load after first paint) ────────────
  // ponytail: initial value comes from the server (already-extracted row).
  // When null, the reader-side ensure-metadata endpoint runs the extraction
  // (idempotent — short-circuits server-side if the upload's background
  // trigger already finished). The spinner appears only if this takes >1s.
  const [description, setDescription] = useState<string | null>(
    bookDescription ?? null
  );
  const [descriptionLoading, setDescriptionLoading] = useState(
    !bookDescription
  );

  // ─── Position state ────────────────────────────────────────────────────────────
  const [savedPosition, setSavedPosition] = useState<SavedPosition | null>(null);

  // Ref to hold the debounce timeout ID — cleared on unmount and before re-setting
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Most recent position; read by flush helpers on unmount / tab hide so the
  // latest page is not lost when the 3s debounce hasn't fired yet.
  const lastPositionRef = useRef<SavedPosition | null>(null);
  // ponytail: cached epub.js rendition so handleSaveBookmark can compute the
  // synthetic "page" (book.locations.locationFromCfi) — same location system the
  // progress bar uses. Set in handleRenditionReady. Ceiling: if locations aren't
  // generated yet at save time (rare — user bookmarks before first paint settles),
  // locationFromCfi returns -1 and pageNumber falls back to null.
  const renditionRef = useRef<any>(null);

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
    // ponytail: re-fetch the library so BookshelfSnapshot's clone reflects
    // post-read recency order. Without this, a user who deep-linked to
    // multiple books in one session would see those books in pre-read order
    // in the snapshot but post-read order in the real shelf — a visible
    // reshuffle at swap. flushSync forces a synchronous commit so the
    // snapshot's useLayoutEffect re-clones into [data-scene-clone] before
    // backToLibrary fires. Non-blocking on failure — fall back to the
    // initial server-fetched snapshot.
    try {
      const res = await fetch("/api/books");
      if (res.ok) {
        const data = (await res.json()) as { books: LibraryBook[] };
        if (Array.isArray(data.books) && data.books.length > 0) {
          flushSync(() => setLibrarySnapshot(data.books));
        }
      }
    } catch (err) {
      console.warn(
        "[ReaderClient] Library re-fetch failed (non-blocking):",
        err,
      );
    }
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
    const sinceAction =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      lastActionTimeRef.current;
    if (
      !shouldDisplayProgress(
        pct,
        displayedPctRef.current,
        lastActionDirRef.current,
        sinceAction,
      )
    )
      return;
    displayedPctRef.current = pct;
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
      // ponytail: apply the same direction-aware wobble gate as the progress
      // bar so transient wrong-direction percentages don't get persisted to DB.
      // Both this and handleProgressChange fire per relocated; whichever runs
      // first mutates displayedPctRef, the other sees the updated value and
      // agrees. CFI/paragraph update unconditionally — position is always
      // accurate even if the bar lags.
      const sinceAction =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        lastActionTimeRef.current;
      const accepted = shouldDisplayProgress(
        percentage,
        displayedPctRef.current,
        lastActionDirRef.current,
        sinceAction,
      );
      if (accepted) displayedPctRef.current = percentage;
      const next: SavedPosition = {
        paragraphIndex: position.paragraphIndex,
        charOffset: position.charOffset,
        cfi,
        percentage: accepted ? percentage : displayedPctRef.current,
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
        // ponytail: derive the synthetic page from epub.js locations, same as
        // bookmarks. Falls back to null if locations aren't generated yet.
        const loc = renditionRef.current?.book?.locations;
        let pageNumber: number | null = null;
        if (loc && typeof loc.locationFromCfi === "function") {
          const idx = loc.locationFromCfi(selectedCfi);
          if (typeof idx === "number" && idx >= 0) pageNumber = idx + 1;
        }
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
            pageNumber,
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
    // ponytail: floating toolbar → passage thread. Set the pending request,
    // open the bulb tool, dismiss the toolbar. The panel picks it up via effect.
    if (!selectedText.trim()) return;
    setPendingRequest({ type: "passage", text: selectedText, cfi: selectedCfi });
    setActiveTool("bulb");
    setToolbarVisible(false);
  }, [selectedText, selectedCfi]);

  const handleAskAboutSection = useCallback((href: string, _label: string) => {
    // ponytail: ToC ⋯ menu → section thread. _label reserved for future
    // UI affordance (e.g. toast "Asking about <chapter>"); not currently used.
    setPendingRequest({ type: "section", sectionHref: href, sectionTitle: _label });
    setActiveTool("bulb");
  }, []);

  const handleAskAboutBook = useCallback(() => {
    setPendingRequest({ type: "book" });
    setActiveTool("bulb");
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
      // ponytail: derive the synthetic page from epub.js locations (the same
      // system the progress bar uses) — NOT paragraphIndex, which the codebase
      // flags as an unreliable placeholder. locationFromCfi returns a 0-based
      // index after locations.generate() resolves; guard for the pre-generation
      // window and fall back to null.
      const loc = renditionRef.current?.book?.locations;
      let pageNumber: number | null = null;
      if (loc && typeof loc.locationFromCfi === "function") {
        const idx = loc.locationFromCfi(cfi);
        if (typeof idx === "number" && idx >= 0) pageNumber = idx + 1;
      }
      try {
        const res = await fetch("/api/reader/bookmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookId,
            cfi,
            paragraphIndex: savedPosition?.paragraphIndex ?? 0,
            charOffset: savedPosition?.charOffset ?? 0,
            pageNumber,
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

  // ─── Auto-hide chrome when sidebar is closed and pointer is idle ────────────
  const scheduleHideChrome = useCallback(() => {
    if (pointerTimeoutRef.current) clearTimeout(pointerTimeoutRef.current);
    pointerTimeoutRef.current = setTimeout(() => setPointerActive(false), 1500);
  }, []);

  const handlePointerActivity = useCallback(() => {
    setPointerActive(true);
    scheduleHideChrome();
  }, [scheduleHideChrome]);

  // ponytail: window-level pointermove covers the chrome + book wrapper outside
  // the epub iframe. The iframe's contentDocument listener (wired in
  // handleRenditionReady) covers movement inside the book content, since iframe
  // events don't bubble to the parent window.
  useEffect(() => {
    window.addEventListener("pointermove", handlePointerActivity);
    return () => window.removeEventListener("pointermove", handlePointerActivity);
  }, [handlePointerActivity]);

  // ponytail: when the sidebar closes, kick the hide countdown so chrome fades
  // even if the pointer never moves. When it opens, cancel the countdown and
  // force the chrome visible.
  useEffect(() => {
    if (activeTool === null && isLoaded) {
      scheduleHideChrome();
    } else if (pointerTimeoutRef.current) {
      clearTimeout(pointerTimeoutRef.current);
      pointerTimeoutRef.current = null;
      setPointerActive(true);
    }
    return () => {
      if (pointerTimeoutRef.current) {
        clearTimeout(pointerTimeoutRef.current);
        pointerTimeoutRef.current = null;
      }
    };
  }, [activeTool, isLoaded, scheduleHideChrome]);

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
      // ponytail: tag direction+time so the wobble gate can reject transient
      // backward CFIs epub.js measures mid-transition during forward nav.
      lastActionDirRef.current = "forward";
      lastActionTimeRef.current = performance.now();
      viewerRef.current?.next().catch((err) => console.error("[Reader] next() error:", err));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      lastActionDirRef.current = "backward";
      lastActionTimeRef.current = performance.now();
      viewerRef.current?.prev().catch((err) => console.error("[Reader] prev() error:", err));
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Clean up the iframe keydown/pointermove listener on unmount
  useEffect(() => {
    return () => {
      iframeDocRef.current?.removeEventListener("keydown", handleKeyDown);
      iframeDocRef.current?.removeEventListener("pointermove", handlePointerActivity);
      iframeDocRef.current = null;
    };
  }, [handleKeyDown, handlePointerActivity]);

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
        iframeDocRef.current?.removeEventListener("pointermove", handlePointerActivity);
        doc.addEventListener("keydown", handleKeyDown);
        doc.addEventListener("pointermove", handlePointerActivity);
        iframeDocRef.current = doc;
      };
      const r = rendition as any;
      renditionRef.current = r;
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
    [highlightsData, handleKeyDown, handlePointerActivity]
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

  // ─── Lazy book-description fetch (stray books + just-uploaded) ──────────────
  // ponytail: skip when the server already had a description row. Otherwise
  // fire POST /api/reader/ensure-metadata, which short-circuits server-side
  // if a row already exists by the time it lands (e.g. upload's background
  // extraction just finished). No toast on error — failures land in the admin
  // Errors page; the reader just shows no description. descriptionLoading is
  // seeded true when bookDescription is null, so no need to toggle it here.
  useEffect(() => {
    if (bookDescription) return;
    if (!bookId) return;
    let cancelled = false;
    fetch("/api/reader/ensure-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId }),
    })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setDescription(data?.metadata?.description ?? null);
        setDescriptionLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDescriptionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, bookDescription]);

  // ─── TTS Playback ──────────────────────────────────────────────────────────
  // ponytail: role drives the "Premium" gate; fall back to regular when the
  // session is still loading so nothing premium flashes for anon users.
  const userRole: UserRole =
    ((user as any)?.role as UserRole) ?? "regular";
  const ttsLang = bookLanguage ?? "en";
  const [enginePref, setEnginePref] = useState<EngineId>(() =>
    defaultEngineForLanguage(ttsLang),
  );
  const [voicePref, setVoicePref] = useState<string>("");

  // ponytail: Kokoro requires WebGPU. On browsers without it (Safari stable,
  // older Firefox), switch to the zero-download browser engine instead of
  // hanging on a doomed Kokoro load attempt. Runs in useEffect to avoid SSR
  // hydration mismatch (navigator doesn't exist identically on server/client).
  useEffect(() => {
    if (typeof navigator !== "undefined" && !("gpu" in navigator)) {
      setEnginePref((prev) => (prev === "kokoro" || prev === "supertonic" ? "browser" : prev));
    }
  }, []);

  // ponytail: load saved engine/voice once per book language. If the saved
  // engine no longer supports this language (language map changed), drop it
  // and keep the default. Runs on language change, not every render.
  // setState-in-effect is intentional here (one-shot pref hydration); same
  // pattern as the sidebar/entry effects below.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = loadTtsPref(ttsLang);
    if (
      saved.engineId &&
      engineSupportsLanguage(saved.engineId, ttsLang)
    ) {
      setEnginePref(saved.engineId);
    }
    if (saved.voiceId) {
      setVoicePref(saved.voiceId);
    }
  }, [ttsLang]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ponytail: persist resolved prefs (waits for voice to settle so we don't
  // save the transient "" before the reset effect picks a default).
  useEffect(() => {
    if (!voicePref) return;
    saveTtsPref(ttsLang, { engineId: enginePref, voiceId: voicePref });
  }, [ttsLang, enginePref, voicePref]);

  const flatToc = useCallback(() => {
    const items: Array<{ label: string; href: string }> = [];
    function walk(nodes: typeof toc) {
      for (const node of nodes) {
        items.push({ label: node.label, href: node.href });
        if (node.subitems) walk(node.subitems);
      }
    }
    walk(toc);
    return items;
  }, [toc]);

  const getNextSection = useCallback(
    (href: string) => {
      const items = flatToc();
      const idx = items.findIndex((i) => i.href === href);
      return idx >= 0 && idx < items.length - 1 ? items[idx + 1] : null;
    },
    [flatToc],
  );

  const browserTts = useTtsEngine({
    bookId,
    bookLanguage: bookLanguage ?? "en",
    viewerRef,
    engineId: enginePref,
    voiceId: voicePref,
    onSectionComplete: () => {
      const next = getNextSection(browserTts.state.sectionHref);
      if (next) {
        setCurrentHref(next.href);
        browserTts.startSection(next.href, next.label);
      }
    },
  });

  // ponytail: snap voicePref to the active engine's voice catalog. Uses the
  // hook's effectiveEngineId (not enginePref) so a WebGPU→browser fallback
  // refreshes the picker to browser voices instead of leaving a stale list
  // pinned to the failed engine's catalog.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const engine = ENGINES[browserTts.effectiveEngineId];
    const voices = engine?.getVoices(ttsLang) ?? [];
    if (voices.length === 0) {
      if (voicePref !== "") setVoicePref("");
      return;
    }
    if (!voices.some((v) => v.id === voicePref)) {
      setVoicePref(voices[0].id);
    }
  }, [browserTts.effectiveEngineId, ttsLang, voicePref]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ponytail: cloud path (Task 7). Always mounted so the audio element ref is
  // stable; reader-client decides which hook drives the UI via `isCloud`.
  // onQuotaExhausted snaps the engine pref back to kokoro when the limit hits.
  const cloudAudioRef = useRef<HTMLAudioElement | null>(null);
  const cloudTts = useTtsCloud({
    bookId,
    toc,
    currentHref,
    audioRef: cloudAudioRef,
    onNavigateToSection: handleTocNavigate,
    onQuotaExhausted: useCallback(() => setEnginePref("kokoro"), []),
    // ponytail: regular tier can't use cloud — skip the mount-time quota fetch.
    enabled: userRole !== "regular",
  });

  // ponytail: dispatcher — cloud is gated by tier (regular → forced to browser).
  const isCloud = enginePref === "cloud" && userRole !== "regular";
  // ponytail: pull state slices off the hook returns for cleaner JSX reads.
  const cloudState = cloudTts.state.state;
  const browserPhase = browserTts.state.phase;

  // ponytail: mirrors the chrome TtsTrigger onClick — same action, second entry
  // point. Dispatches on isCloud so either engine can be started from here.
  const handleListenFromHere = useCallback(() => {
    if (isCloud) {
      const cs = cloudTts.state.state;
      if (cs === "IDLE" || cs === "ENDED") {
        const section = toc.find((item) => item.href === currentHref);
        cloudTts.startSection(currentHref, section?.label || "Reading");
      } else {
        cloudTts.togglePlayPause();
      }
      return;
    }
    if (
      browserTts.state.phase === "IDLE" ||
      browserTts.state.phase === "ENDED"
    ) {
      const section = toc.find((item) => item.href === currentHref);
      browserTts.startSection(currentHref, section?.label || "Reading");
    } else if (browserTts.state.phase === "PLAYING") {
      browserTts.pause();
    } else if (browserTts.state.phase === "PAUSED") {
      browserTts.resume();
    }
  }, [browserTts, cloudTts, isCloud, toc, currentHref]);

  const ttsPlaybackState: TtsPlaybackState = useMemo(() => {
    if (isCloud) return cloudTts.state;
    const phase = browserTts.state.phase;
    return {
      state:
        phase === "IDLE"
          ? "IDLE"
          : phase === "LOADING"
            ? "LOADING"
            : phase === "PLAYING"
              ? "PLAYING"
              : phase === "PAUSED"
                ? "READY"
                : "ENDED",
      sectionTitle: browserTts.state.sectionTitle,
      sectionHref: browserTts.state.sectionHref,
      audioUrl: null,
      audioId: null,
      currentTime: 0,
      duration: 0,
    };
  }, [browserTts.state, cloudTts.state, isCloud]);

  const handleTtsPlayPause = useCallback(() => {
    if (isCloud) {
      cloudTts.togglePlayPause();
      return;
    }
    if (browserTts.state.phase === "PLAYING") {
      browserTts.pause();
    } else if (
      browserTts.state.phase === "PAUSED" ||
      browserTts.state.phase === "ENDED"
    ) {
      browserTts.resume();
    }
  }, [browserTts, cloudTts, isCloud]);

  const handleTtsClose = useCallback(() => {
    if (isCloud) {
      cloudTts.close();
      return;
    }
    browserTts.close();
  }, [browserTts, cloudTts, isCloud]);

  // ponytail: active quota for the player badge — null when not on cloud.
  const activeQuota: CloudQuota | null = isCloud ? cloudTts.quota : null;

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
  // section loads. ponytail: only the cloud path uses an <audio> element;
  // browser engines go through AudioContext (handled in use-tts-engine).
  useEffect(() => {
    if (cloudAudioRef.current) {
      cloudAudioRef.current.playbackRate = bookSettings.voiceSpeed;
    }
  }, [bookSettings.voiceSpeed, cloudAudioRef, cloudState]);

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
  // ponytail: track sidebar open/close transitions to fire the epub re-pagination dip
  useEffect(() => {
    const isOpen = activeTool !== null;
    if (prevOpenRef.current !== isOpen) {
      prevOpenRef.current = isOpen;
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
  // ponytail: one-shot entry effect opens the sidebar concurrent with slide-in
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!entering && !isLoaded) return;
    autoOpenedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTool((prev) => prev ?? "reader");
  }, [entering, isLoaded]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      data-sidebar-open={activeTool ? "true" : "false"}
      className={cn(
        "relative h-full w-full",
        (browserPhase !== "IDLE" || cloudState !== "IDLE") && "pb-16",
      )}
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
      {/* ponytail: BookshelfSnapshot — provides the receding-library background
          for back-nav when the user deep-linked/refreshed (no forward clone).
          Renders off-screen and self-mounts into [data-scene-clone] via
          cloneNode. No-op when a forward-captured clone is already present. */}
      <BookshelfSnapshot
        books={librarySnapshot}
        userName={libraryUserName}
        digestImage={libraryDigestImage}
      />

      {/* Hidden audio element for cloud TTS playback */}
      <audio ref={cloudAudioRef} className="hidden" />

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
              visible during entry. Reveal: the skeleton stays opaque until the
              EPUB has rendered (isLoaded) AND the entry transition has ended
              (!entering ≈ cover-fly handoff ≈ 800ms) — so the cover is the last
              thing that moves — then fades out to expose the page beneath.
              Reduced motion → instant reveal. */}
          {reducedMotion
            ? (!isLoaded || entering) && <ReaderSkeleton />
            : !contentRevealed && (
                <ReaderSkeleton
                  visible={!isLoaded || entering}
                  onFadeOut={() => setContentRevealed(true)}
                />
              )}
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

      {/* ponytail: all three "ask about" entry points (passage via floating
          toolbar, section via ToC dropdown, book via button) now flow into
          the sidebar's bulb tool as threads. The old Sheet-based ExplainerPanel
          is gone; the ExplainerThreadsPanel handles every case. */}

      {/* Reader chrome + reading progress — only shown once loaded and no error */}
      {isLoaded && !error && (
        <>
          <ReaderChrome
            onBack={handleBack}
            sidebarOpen={activeTool !== null}
            hidden={activeTool === null && !pointerActive}
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
                  isCloud
                    ? cloudState === "GENERATING" || cloudState === "LOADING"
                      ? "loading"
                      : cloudState === "IDLE" || cloudState === "ENDED"
                        ? "idle"
                        : "disabled"
                    : browserPhase === "LOADING"
                      ? "loading"
                      : browserPhase === "IDLE" ||
                          browserPhase === "ENDED"
                        ? "idle"
                        : "disabled"
                }
                onClick={handleListenFromHere}
              />
            }
          />
          <ReadingProgress
            percentage={percentage}
            sidebarOpen={activeTool !== null}
            hidden={activeTool === null && !pointerActive}
          />
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
                description={description}
                descriptionLoading={descriptionLoading}
                toc={toc}
                currentHref={currentHref}
                onNavigate={handleTocNavigate}
                initialLanguage={initialLanguage}
                onListenFromHere={handleListenFromHere}
                isAdmin={isAdmin}
                bookCreatedAt={bookCreatedAt}
                coverHidden={forwardFlyActive}
                onAskAboutSection={handleAskAboutSection}
                onAskAboutBook={handleAskAboutBook}
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
            bulb: (
              <ExplainerThreadsPanel
                bookId={bookId}
                pendingRequest={pendingRequest}
                onConsumed={() => setPendingRequest(null)}
                onCloseSidebar={() => setActiveTool(null)}
                onReturnToSidebar={() => setActiveTool("bulb")}
                bookTxtTokens={bookTxtTokens}
                contextWindow={contextWindow}
              />
            ),
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
        state={ttsPlaybackState}
        loadPct={browserTts.state.loadPct}
        onPlayPause={handleTtsPlayPause}
        onScrub={(t) => {
          // ponytail: cloud supports scrub via audio.currentTime; browser v1 doesn't.
          if (isCloud) cloudTts.scrub(t);
        }}
        onClose={handleTtsClose}
        bookLanguage={ttsLang}
        enginePref={enginePref}
        effectiveEngineId={browserTts.effectiveEngineId}
        onEngineChange={setEnginePref}
        voicePref={voicePref}
        onVoiceChange={setVoicePref}
        userRole={userRole}
        quota={activeQuota}
      />
    </div>
  );
}
