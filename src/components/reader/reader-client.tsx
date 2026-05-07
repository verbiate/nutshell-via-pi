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

export interface ReaderClientProps {
  bookId: string;
  bookTitle?: string;
  epubUrl: string;
}

export function ReaderClient({ bookId, bookTitle, epubUrl }: ReaderClientProps) {
  const router = useRouter();
  const viewerRef = useRef<EpubViewerHandle>(null);

  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentHref, setCurrentHref] = useState<string>("");
  const [percentage, setPercentage] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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

  const handlePositionChange = useCallback(
    (_position: { paragraphIndex: number; charOffset: number }, cfi: string) => {
      // TODO: Persist to API (Plan 04 wires this)
      void _position;
      void cfi;
    },
    []
  );

  const handleRenditionReady = useCallback((_rendition: unknown) => {
    setIsLoaded(true);
  }, []);

  const handleError = useCallback((err: Error) => {
    setError(err);
  }, []);

  // Keyboard shortcut: 't' to cycle theme
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "t" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Theme toggle is handled inside ThemeToggle component
        // This listener is for future theme-cycle shortcut if needed
        void e;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
