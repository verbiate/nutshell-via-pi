"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import { AlertTriangle, Lightbulb, Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BookCover } from "@/components/library/book-cover";
import { PlaySectionMenuItems } from "@/components/audio/play-section-menu";
import type { PlaylistBookMeta } from "@/types/playlist";

// ponytail: leading-trim/text-edge are draft CSS (css-inline-3) that crop the
// half-leading inset so the cap-height box matches the Figma box exactly.
// Progressive enhancement — unsupported engines (no Safari/Chrome support yet)
// just render with normal leading, no visual breakage. Cast because csstype
// hasn't shipped these keys yet.
const TRIM_STYLE = { leadingTrim: "both", textEdge: "cap" } as CSSProperties;

interface TocEntryProps {
  item: NavItem;
  onNavigate: (href: string) => void;
  level?: number;
  currentHref?: string;
  onAskAboutSection?: (href: string, label: string) => void;
  bookId: string;
  bookMeta: PlaylistBookMeta;
}

function TocEntry({
  item,
  onNavigate,
  level = 0,
  currentHref,
  onAskAboutSection,
  bookId,
  bookMeta,
}: TocEntryProps) {
  const isActive = currentHref ? item.href === currentHref : false;

  return (
    <div>
      {/*
        ponytail: the overflow menu is absolutely positioned so it overlays the
        row's right edge instead of competing for flex width — long chapter
        titles keep the full sidebar width and only wrap when they genuinely
        exceed it, rather than being squeezed by the icon's box.
      */}
      <div className="group relative flex items-center">
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
            "type-toc-section flex-1 text-left py-2 pr-10 transition-colors",
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
          ponytail: hover-revealed overflow menu. "Ask about this" opens the
          section explainer as a thread in the sidebar's bulb tool — same UI as
          passage explainers. The play affordance lives here too: one item when
          the playlist is empty ("Start reading from here"), three when it isn't
          (Play now / next / last) — inline items, never a submenu.
        */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 opacity-100 transition-opacity hover:bg-accent md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
              aria-label={`More actions for ${item.label}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          {/* ponytail: shadcn's default sizes content to the trigger width
              (24px icon → collapses to the 128px min-w-32 floor), which wraps
              "Start reading from here". w-fit sizes to the longest item instead. */}
          <DropdownMenuContent align="end" className="w-fit min-w-48">
            <DropdownMenuItem
              onClick={() => onAskAboutSection?.(item.href, item.label)}
            >
              <Lightbulb className="h-4 w-4 text-lav" />
              Ask about this
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <PlaySectionMenuItems
              bookId={bookId}
              sectionHref={item.href}
              sectionLabel={item.label}
              bookMeta={bookMeta}
              startPos={(() => {
                const hashIdx = item.href.indexOf("#");
                return hashIdx >= 0
                  ? { elementId: item.href.slice(hashIdx + 1) }
                  : undefined;
              })()}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {item.subitems && item.subitems.length > 0 && (
        <div>
          {item.subitems.map((child) => (
            <TocEntry
              key={child.id || child.href}
              item={child}
              onNavigate={onNavigate}
              level={level + 1}
              currentHref={currentHref}
              onAskAboutSection={onAskAboutSection}
              bookId={bookId}
              bookMeta={bookMeta}
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
  metadataTitle?: string | null;
  subtitle?: string | null;
  description?: string | null;
  descriptionLoading?: boolean;
  isNarrative?: boolean | null;
  toc: NavItem[];
  currentHref: string;
  onNavigate: (href: string) => void;
  initialLanguage: string;
  onAskAboutSection?: (href: string, label: string) => void;
  onAskAboutBook?: () => void;
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
  language,
  description,
  descriptionLoading,
  metadataTitle,
  subtitle,
  isNarrative,
  toc,
  currentHref,
  onNavigate,
  initialLanguage,
  onAskAboutSection,
  onAskAboutBook,
  isAdmin,
  bookCreatedAt,
  coverHidden,
}: ReaderPanelProps) {
  // ponytail: 1s grace before showing the extraction spinner. Avoids flashing
  // a loader on fast hits (cache row exists, or LLM returns within a second).
  // We never need to reset showSpinner to false explicitly — the render below
  // gates on `descriptionLoading && showSpinner`, so once loading completes
  // (loading=false) the spinner is hidden regardless of showSpinner's value.
  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    if (!descriptionLoading) return;
    const t = setTimeout(() => setShowSpinner(true), 1000);
    return () => clearTimeout(t);
  }, [descriptionLoading]);

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
          {/*
            ponytail: prefer the LLM-extracted main title (BookMetadata.title)
            over EpubFile.title when metadata exists — the OPF title often
            concatenates the subtitle, so we split them out below. Falls back
            to the full title for stray books with no metadata row yet.
          */}
          <h3
            title={bookTitle}
            className="line-clamp-3 font-serif text-[20px] font-medium leading-[1.2] text-foreground"
            style={{
              letterSpacing: "-0.005em",
              hangingPunctuation: "first last",
              ...TRIM_STYLE,
            }}
          >
            {metadataTitle ?? bookTitle}
          </h3>
          {subtitle && (
            <p
              className="mt-0.5 line-clamp-3 font-serif text-[15px] font-medium leading-[1.3] text-foreground"
              style={{
                hangingPunctuation: "first last",
                ...TRIM_STYLE,
              }}
            >
              {subtitle}
            </p>
          )}
          {author && (
            <p
              className="mt-1 truncate font-sans text-[15px] font-semibold leading-[1.35] text-foreground/60"
              style={{ hangingPunctuation: "first last" }}
            >
              {author}
            </p>
          )}
        </div>
      </div>

      {/* Description: LLM-generated single-sentence explainer from
          BookMetadata. Three states — present (show), loading past 1s
          (show spinner), or absent/loading under 1s (render nothing to
          avoid flashing the slot). */}
      {description ? (
        <p
          className="px-12 font-sans text-[13px] leading-[1.5] text-foreground/70"
          style={{ hangingPunctuation: "first last" }}
        >
          {description}
        </p>
      ) : showSpinner && descriptionLoading ? (
        <div className="flex items-center gap-2 px-12">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-[13px] text-muted-foreground">
            Extracting description…
          </span>
        </div>
      ) : null}

      {/* Action row */}
      <div className="flex flex-col gap-3 px-12">
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={onAskAboutBook}
        >
          <Lightbulb />
          Ask the book
        </Button>
      </div>

      {/*
        ponytail: narrative spoiler advisory. isNarrative is null until the
        BookMetadata row lands (SSR or lazy ensure-metadata) — only show when
        the LLM positively flagged it true. Sits under the explainer entry
        point ("Ask the book") so the warning reads in context.
      */}
      {isNarrative === true && (
        <div className="flex items-start gap-2 px-12">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-peach"
            aria-hidden
          />
          <p className="text-[12px] font-medium leading-[1.4] text-foreground/60">
            This is a narrative work. Explainers may contain spoilers.
          </p>
        </div>
      )}

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
                onAskAboutSection={onAskAboutSection}
                bookId={bookId}
                bookMeta={{
                  bookTitle,
                  bookAuthor: author,
                  bookCoverPath: coverPath,
                  bookLanguage: language,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
