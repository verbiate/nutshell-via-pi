'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { NavItem } from '@likecoin/epub-ts';
import { useTheme } from 'next-themes';

import { ReaderChrome } from './reader-chrome';
import { TocPanel } from './toc-panel';
import { ThemeToggle } from './theme-toggle';
import { ReadingProgress } from './reading-progress';
import { ReaderSkeleton } from './reader-skeleton';
import { ReaderError } from './reader-error';
import { EpubViewer, type EpubViewerHandle } from './epub-viewer';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ReaderClientProps {
  bookId: string;
  bookTitle?: string;
  epubUrl: string;
}

export function ReaderClient({ bookId, bookTitle, epubUrl }: ReaderClientProps) {
  const router = useRouter();
  const viewerRef = useRef<EpubViewerHandle>(null);
  const { resolvedTheme, setTheme } = useTheme();

  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentHref, setCurrentHref] = useState<string | undefined>(undefined);
  const [percentage, setPercentage] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const handleBack = useCallback(() => {
    router.push('/my-library');
  }, [router]);

  const handleRetry = useCallback(() => {
    setError(null);
    setIsLoaded(false);
    // Force remount of EpubViewer by key-changing if needed
    window.location.reload();
  }, []);

  const handleTocNavigate = useCallback(async (href: string) => {
    await viewerRef.current?.navigateTo(href);
  }, []);

  const handleThemeToggle = useCallback(() => {
    if (resolvedTheme === 'light') setTheme('sepia');
    else if (resolvedTheme === 'sepia') setTheme('dark');
    else setTheme('light');
  }, [resolvedTheme, setTheme]);

  const handleTocLoaded = useCallback((loadedToc: NavItem[]) => {
    setToc(loadedToc);
  }, []);

  const handlePositionChange = useCallback(
    (position: { paragraphIndex: number; charOffset: number }) => {
      // TODO: Persist to API
      void position;
    },
    []
  );

  const handleLoadChange = useCallback((loaded: boolean) => {
    setIsLoaded(loaded);
  }, []);

  const handleError = useCallback((err: Error) => {
    setError(err);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Let Sheet handle its own escape, then back
      } else if (e.key === 't' && !e.metaKey && !e.ctrlKey) {
        handleThemeToggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleThemeToggle]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      {/* EPUB Content */}
      <div className="absolute inset-0">
        <EpubViewer
          ref={viewerRef}
          url={epubUrl}
          theme={resolvedTheme as 'light' | 'dark' | 'sepia'}
          onTocLoaded={handleTocLoaded}
          onPositionChange={handlePositionChange}
          onLoadChange={handleLoadChange}
          onError={handleError}
          className="h-full w-full"
        />
      </div>

      {/* Loading State */}
      {!isLoaded && !error && <ReaderSkeleton />}

      {/* Error State */}
      {error && <ReaderError onBack={handleBack} onRetry={handleRetry} />}

      {/* Reader Chrome - only show when loaded */}
      {isLoaded && !error && (
        <>
          <ReaderChrome
            bookTitle={bookTitle}
            onBack={handleBack}
            onTocOpen={() => {}} // TocPanel manages its own open state
            onThemeToggle={handleThemeToggle}
            theme={resolvedTheme as 'light' | 'dark' | 'sepia'}
          />

          {/* ToC Panel - positioned in chrome area */}
          <div className="absolute top-3 left-1 z-50">
            <TocPanel
              toc={toc}
              currentHref={currentHref}
              onNavigate={handleTocNavigate}
            />
          </div>

          {/* Reading Progress */}
          <ReadingProgress percentage={percentage} />
        </>
      )}
    </div>
  );
}
