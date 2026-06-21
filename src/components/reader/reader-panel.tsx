"use client";

import { useState } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import { Lightbulb, MoreHorizontal, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ExplainerPanel } from "@/components/explainer/explainer-panel";
import { BookCover } from "@/components/library/book-cover";

interface TocEntryProps {
  item: NavItem;
  onNavigate: (href: string) => void;
  level?: number;
  currentHref?: string;
  bookId: string;
  initialLanguage: string;
}

function TocEntry({
  item,
  onNavigate,
  level = 0,
  currentHref,
  bookId,
  initialLanguage,
}: TocEntryProps) {
  const isActive = currentHref ? item.href === currentHref : false;
  const [explainerOpen, setExplainerOpen] = useState(false);

  return (
    <div>
      <div className="group relative flex items-center pr-12">
        {/*
          ponytail: active top-level rows get a left accent bar (the mockup's
          chapter indicator). Subitems keep their existing indent border instead
          — mixing a bar into the indented column reads as noise.
        */}
        {isActive && level === 0 && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-lav"
          />
        )}
        <button
          onClick={() => onNavigate(item.href)}
          className={cn(
            "type-toc-section flex-1 text-left py-2 pr-4 transition-colors",
            isActive
              ? "font-medium text-foreground"
              : "font-normal text-foreground hover:text-primary",
            level > 0 && "border-l-2 border-border ml-4"
          )}
          style={{
            paddingLeft: level > 0 ? `${48 + level * 16}px` : "48px",
          }}
        >
          {item.label}
        </button>
        {/*
          ponytail: hover-revealed overflow menu (matches the prior lightbulb's
          reveal model). Single item for now — "Ask about this" opens the
          section Explainer, same as the old lightbulb. Room to add per-section
          actions (Listen from here, etc.) without touching row layout.
        */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 opacity-100 transition-opacity shrink-0 hover:bg-accent md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
              aria-label={`Ask about ${item.label}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setExplainerOpen(true)}>
              <Lightbulb className="h-4 w-4 text-lav" />
              Ask about this
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ExplainerPanel
        open={explainerOpen}
        onOpenChange={setExplainerOpen}
        bookId={bookId}
        type="section"
        sectionHref={item.href}
        sectionTitle={item.label}
        initialLanguage={initialLanguage}
      />
      {item.subitems && item.subitems.length > 0 && (
        <div>
          {item.subitems.map((child) => (
            <TocEntry
              key={child.id || child.href}
              item={child}
              onNavigate={onNavigate}
              level={level + 1}
              currentHref={currentHref}
              bookId={bookId}
              initialLanguage={initialLanguage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export interface ReaderPanelProps {
  bookId: string;
  bookTitle: string;
  author?: string | null;
  coverPath?: string | null;
  language?: string;
  toc: NavItem[];
  currentHref: string;
  onNavigate: (href: string) => void;
  initialLanguage: string;
  onListenFromHere: () => void;
  isAdmin?: boolean;
  bookCreatedAt?: string;
  /** When true, the cover is hidden (held empty) so a forward fly clone can land
   * into it; revealed when the fly completes. */
  coverHidden?: boolean;
}

export function ReaderPanel({
  bookId,
  bookTitle,
  author,
  coverPath,
  toc,
  currentHref,
  onNavigate,
  initialLanguage,
  onListenFromHere,
  isAdmin,
  bookCreatedAt,
  coverHidden,
}: ReaderPanelProps) {
  const [bookExplainerOpen, setBookExplainerOpen] = useState(false);

  return (
    <div className="flex flex-col gap-9">
      {/* Book details card */}
      {/*
        ponytail: row is items-start + the cover is self-start so the cover's
        top is ALWAYS cardTop (never shifted by title/author height). That makes
        the cover's resting rect statically computable for the forward fly
        (computeReaderCoverRect in scene-transition.tsx). The text column still
        reads as vertically centered against the cover: it stretches
        (self-stretch) to the cover's height and centers its block internally.
        For long titles where text > cover, the cover stays pinned at top
        (determinism wins) and the column simply grows.
      */}
      <div className="flex items-start gap-3 px-12 pt-12">
        {/* data-hero-cover: the fly transition clones this frame. Fixed width +
            natural aspect (matching the bookshelf card) so the fly clone lands
            at the correct size/treatment. shadow-book unifies the frame with the
            shelf. No opacity transition — the cover snaps opaque under the fly
            clone at the handoff so its fade-out reveals it cleanly. coverHidden
            holds it empty while a fly is inbound, then reveals. */}
        <div
          className="relative w-[var(--reader-cover-w)] shrink-0 self-start overflow-hidden rounded-md bg-paper-deep shadow-book"
          data-hero-cover=""
          style={{ opacity: coverHidden ? 0 : 1 }}
        >
          <BookCover coverPath={coverPath} title={bookTitle} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center self-stretch">
          <h3
            className="line-clamp-3 font-serif text-[20px] font-medium leading-[1.2] text-foreground"
            style={{
              letterSpacing: "-0.005em",
              hangingPunctuation: "first last",
            }}
          >
            {bookTitle}
          </h3>
          {author && (
            <p
              className="mt-1 truncate font-sans text-[15px] font-semibold leading-[1.35] text-foreground/60"
              style={{ hangingPunctuation: "first last" }}
            >
              {author}
            </p>
          )}
          {isAdmin && bookCreatedAt && (
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              Uploaded {new Date(bookCreatedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {/* Action row */}
      <div className="flex flex-col gap-3 px-12">
        <Button
          className="w-full gap-2 bg-chocolate text-white hover:bg-chocolate/90"
          onClick={onListenFromHere}
        >
          <Play className="text-blue" />
          Listen from here
        </Button>
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => setBookExplainerOpen(true)}
        >
          <Lightbulb />
          Ask the book
        </Button>
      </div>
      <ExplainerPanel
        open={bookExplainerOpen}
        onOpenChange={setBookExplainerOpen}
        bookId={bookId}
        type="book"
        initialLanguage={initialLanguage}
      />

      {/* Table of contents */}
      {toc.length > 0 && (
        <div>
          <div className="py-1">
            {toc.map((item) => (
              <TocEntry
                key={item.id || item.href}
                item={item}
                onNavigate={onNavigate}
                level={0}
                currentHref={currentHref}
                bookId={bookId}
                initialLanguage={initialLanguage}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
