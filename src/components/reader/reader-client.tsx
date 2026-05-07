"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { NavItem } from "@likecoin/epub-ts";
import { EpubViewer, type EpubViewerHandle } from "./epub-viewer";
import { ReaderChrome } from "./reader-chrome";
import { TocPanel } from "./toc-panel";
import { ThemeToggle } from "./theme-toggle";
import { ReadingProgress } from "./reading-progress";
import { ReaderSkeleton } from "./reader-skeleton";
import { ReaderError } from "./reader-error";
import { useSession } from "@/hooks/use-session";

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
  const { user } = useSession();

  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentHref, setCurrentHref] = useState<string>("");
  const [percentage, setPercentage] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const initialLanguage = (user as any)?.preferredLanguage || "en";

  // ─── Position state ───────────────────────────────────────────────────────────
  const [savedPosition, setSavedPosition] = useState<SavedPosition | null>(null);

  // Ref to hold the debounce timeout ID — cleared on unmount and before re-setting
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Load saved position on mount ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadPosition() {
      try {
        const res = await fetch(`/api/reader/position?bookId=${encodeURIComponent(bookId)}`);
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
        console.warn("[ReaderClient] Position fetch failed (non-blocking):", err);
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
        console.warn("[ReaderClient] Position save failed (non-blocking):", err);
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

  const handleRenditionReady = useCallback((_rendition: unknown) => {
    setIsLoaded(true);
  }, []);

  const handleError = useCallback((err: Error) => {
    setError(err);
  }, []);

  // ─── Cleanup: clear pending saves on unmount ─────────────────────────────────
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, []);

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "t" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        void e;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative h-full w-full">
      {/* Error overlay */}
      {error && (
        <ReaderError onBack={handleBack} onRetry={handleRetry} />
      )}

      {/* EPUB viewer */}
      {!error && (
        <EpubViewer
          ref={viewerRef}
          url={epubUrl}
          theme={"light"}
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
          className="h-full w-full"
        />
      )}

      {/* Loading skeleton overlay */}
      {!isLoaded && !error && <ReaderSkeleton />}

      {/* Reader chrome — only shown once loaded and no error */}
      {isLoaded && !error && (
        <>
          <ReaderChrome
            bookTitle={bookTitle ?? "Loading..."}
            onBack={handleBack}
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
          />
          <ReadingProgress percentage={percentage} />
        </>
      )}
    </div>
  );
}
