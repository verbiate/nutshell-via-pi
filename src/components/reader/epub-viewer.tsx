"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import ePub, { Book, Rendition, NavItem } from "@likecoin/epub-ts";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { buildParagraphMap, paragraphOffsetToCfi } from "@/lib/reader/position-tracking";
import type { ParagraphMap } from "@/lib/reader/position-tracking";

export interface EpubViewerProps {
  url: string;
  theme: "light" | "dark" | "sepia";
  initialCfi?: string | null;
  initialPosition?: { paragraphIndex: number; charOffset: number } | null;
  onPositionChange?: (
    position: { paragraphIndex: number; charOffset: number },
    cfi: string
  ) => void;
  onTocLoaded?: (toc: NavItem[]) => void;
  onProgressChange?: (percentage: number) => void;
  onRenditionReady?: (rendition: Rendition) => void;
  onNavigateRequest?: (href: string) => void;
  className?: string;
  onLoadChange?: (isLoaded: boolean) => void;
  onError?: (error: Error) => void;
  onTextSelected?: (cfiRange: string, contents: unknown) => void;
  onSelectionCleared?: () => void;
}

export interface EpubViewerHandle {
  navigateTo: (href: string) => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  getCurrentCfi: () => string | null;
  clearSelection: () => void;
  addHighlight: (cfi: string, color?: string) => void;
  navigateToParagraph: (paragraphIndex: number) => Promise<void>;
}

// epub-ts ThemeEntry format: { rules: { "selector": { "property": "value" } } }
// See: @likecoin/epub-ts/dist/types.d.ts — ThemeEntry interface
const LIGHT_THEME = { rules: { body: { background: "#ffffff", color: "#1a1a1a" } } };
const DARK_THEME = { rules: { body: { background: "#1a1a1a", color: "#e8e8e8" } } };
const SEPIA_THEME = { rules: { body: { background: "#f4ecd8", color: "#5b4636" } } };

export const EpubViewer = forwardRef<EpubViewerHandle, EpubViewerProps>(
  (
    {
      url,
      theme,
      initialCfi,
      initialPosition,
      onPositionChange,
      onTocLoaded,
      onProgressChange,
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

    // Navigate method exposed via ref
    useImperativeHandle(ref, () => ({
      navigateTo: (href: string) => {
        renditionRef.current?.display(href);
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
      addHighlight: (cfi: string, color?: string) => {
        if (!renditionRef.current) return;
        renditionRef.current.annotations.highlight(
          cfi,
          {},
          () => {},
          "br-highlight",
          { fill: color || "#fbbf24" }
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
    }));

    // Initialize EPUB book
    useEffect(() => {
      if (!url || !containerRef.current) return;

      let mounted = true;
      setIsLoaded(false);
      onLoadChange?.(false);

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

          return book.ready.then(() => {
            if (!mounted || !containerRef.current) return;

            // Extract and expose ToC
            if (book.navigation?.toc) {
              onTocLoaded?.(book.navigation.toc);
            }

            // Render to container iframe
            const rendition = book.renderTo(containerRef.current, {
              width: "100%",
              height: "100%",
              flow: "paginated",
              allowScriptedContent: true,
            });
            renditionRef.current = rendition;

            // Register three themes
            rendition.themes.register("light", LIGHT_THEME);
            rendition.themes.register("dark", DARK_THEME);
            rendition.themes.register("sepia", SEPIA_THEME);

            // Apply current theme
            rendition.themes.select(theme);

            // Wire relocated event for progress and position
            rendition.on(
              "relocated",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (location: any) => {
                if (!mounted) return;
                lastCfiRef.current = location.start.cfi ?? null;
                const percentage = (location.start.percentage ?? 0) * 100;
                onProgressChange?.(percentage);
                onPositionChange?.(
                  { paragraphIndex: 0, charOffset: 0 },
                  location.start.cfi
                );
              }
            );

            // Wire text selection events
            rendition.on("selected", (cfiRange: string, contents: unknown) => {
              if (!mounted) return;
              onTextSelected?.(cfiRange, contents);
            });

            // Display the book first
            const displayPromise = rendition.display();

            // If we have a saved CFI, restore to that position after initial display
            if (initialCfi) {
              displayPromise.then(() => {
                if (!mounted) return;
                rendition
                  .display(initialCfi)
                  .catch((err: Error) =>
                    console.warn("[EpubViewer] CFI restore failed:", err)
                  );
              });
            }

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

    // Sync theme changes
    useEffect(() => {
      renditionRef.current?.themes.select(theme);
    }, [theme]);

    return (
      <div className={cn("relative h-full w-full", className)}>
        <div
          ref={containerRef}
          className="h-full w-full"
          aria-label="Book content"
        />
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
