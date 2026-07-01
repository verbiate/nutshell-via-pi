"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import { AlertTriangle, Lightbulb, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OverflowMenuTrigger } from "@/components/ui/overflow-menu-trigger";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BookCover } from "@/components/library/book-cover";
import { SmoothScrollArea } from "@/components/library/smooth-scroll-area";
import { PlaySectionMenuItems } from "@/components/audio/play-section-menu";
import { useAudio } from "@/components/audio/audio-context";
import { findFlatSectionIndex } from "@/lib/reader/spine-playlist";
import type { PlaylistBookMeta } from "@/types/playlist";

// ponytail: leading-trim/text-edge are draft CSS (css-inline-3) that crop the
// half-leading inset so the cap-height box matches the Figma box exactly.
// Progressive enhancement — unsupported engines (no Safari/Chrome support yet)
// just render with normal leading, no visual breakage. Cast because csstype
// hasn't shipped these keys yet.
const TRIM_STYLE = { leadingTrim: "both", textEdge: "cap" } as CSSProperties;

// ponytail: recursive walk mirroring the flattenToc in bookmarks/highlights
// panels. Used to resolve the active row via findFlatSectionIndex (basename +
// fragment aware), so nested chapters light up and path/fragment mismatches
// between epub.js's relocated href and the ToC's normalized href don't break
// the active marker.
function flattenToc(
  items: NavItem[],
  acc: { href: string; label: string }[] = []
): { href: string; label: string }[] {
  for (const item of items) {
    acc.push({ href: item.href, label: item.label });
    if (item.subitems) flattenToc(item.subitems, acc);
  }
  return acc;
}

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
           ponytail: active rows get a hanging dot — a typographic bullet in
           the gutter (left-8, ~16px before the text's 48px optical start),
           decoupled from the sidebar edge so it reads as belonging to the
           line, not the chrome. Applies at every nesting level; subitem rows
           indent via marginLeft so the dot sits clear of their indent rail.
        */}
        {isActive && (
          <span
            aria-hidden
            className="absolute left-8 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-lav"
          />
        )}
        <button
          onClick={() => onNavigate(item.href)}
          className={cn(
            // ponytail: text keeps the full row width — the overflow trigger
            // overlays it on hover (see the mask + trigger below) instead of
            // reserving permanent space, so long chapter titles aren't squeezed.
            // pr-10 bounds the text off the right edge at rest; the mask fades
            // the tail where the trigger appears on hover/touch.
            "type-toc-section flex-1 text-left py-2 pr-10 transition-colors",
            isActive
              ? "font-medium text-foreground"
              : "font-normal text-foreground hover:text-primary",
            level > 0 && "border-l-2 border-border"
          )}
          style={{
            // ponytail: border shares the parent's content edge (48px for level 1,
            // +18px per level = 16 indent + 2px border) so the vertical line reads
            // as an extension of the parent, not a separate left rail.
            marginLeft: level > 0 ? `${48 + (level - 1) * 18}px` : undefined,
            paddingLeft: level > 0 ? "16px" : "48px",
          }}
        >
          {item.label}
        </button>
        {/*
          ponytail: hover/mobile-synced mask. The overflow trigger overlays the
          row's right edge (matching the other panels' 48px offset) instead of
          reserving layout width — so ToC titles keep full width. This gradient
          fades the text tail into the surface exactly where the trigger
          appears, keeping text from peeking around the circle. It mirrors the
          trigger's own visibility rule (visible on touch, hover-revealed at
          md+) so mask and trigger always appear together.
        */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 h-full w-24 bg-gradient-to-l from-background to-transparent opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
        />
        {/*
          ponytail: hover-revealed overflow menu. "Ask about this" opens the
          section explainer as a discussion in the sidebar's bulb tool — same UI as
          passage explainers. The play affordance lives here too: one item when
          the playlist is empty ("Start reading from here"), three when it isn't
          (Play now / next / last) — inline items, never a submenu.
        */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
             {/*
               ponytail: shared overflow trigger (see
               ui/overflow-menu-trigger.tsx). ToC carries the row-positioning
               classes here since the trigger overlays the row.
             */}
             <OverflowMenuTrigger
               label={`More actions for ${item.label}`}
               className="absolute right-12 top-1/2 -translate-y-1/2"
             />
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
  // ponytail: LLM-pinned spine-section href where readable content begins.
  // Drives the "Play from the start" button. Null = not extracted yet or
  // anchor couldn't be pinned to a section (button hidden).
  readableStartSectionHref?: string | null;
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
  readableStartSectionHref,
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

  // ponytail: resolve the active ToC row from epub.js's relocated href.
  // currentHref (a spine href that may carry/omit a #fragment or path prefix
  // the normalized ToC href doesn't) is matched against the flattened ToC via
  // findFlatSectionIndex — basename + fragment aware with a basename-only
  // fallback — so the active marker pins exactly one row at any nesting depth
  // even when the href strings differ. TocEntry then compares strict-equal
  // against this resolved href (both sides are now real ToC hrefs).
  const flatToc = useMemo(() => flattenToc(toc), [toc]);
  const activeHref = useMemo(() => {
    if (!currentHref) return "";
    const idx = findFlatSectionIndex(flatToc, currentHref);
    return idx >= 0 ? flatToc[idx].href : "";
  }, [flatToc, currentHref]);

  return (
    <div className="flex h-full flex-col">
      {/*
        ponytail: fixed header zone — book details card, description, action
        buttons, and narrative advisory stay pinned above the ToC scroll area.
        Matches the Discussions panel's header/body split.
      */}
      <div className="flex shrink-0 flex-col gap-9 pb-6">
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
        <div className="flex flex-col gap-1.5 px-12">
          {readableStartSectionHref && (
            <PlayFromStartButton
              bookId={bookId}
              sectionHref={readableStartSectionHref}
              toc={toc}
              bookMeta={{
                bookTitle,
                bookAuthor: author,
                bookCoverPath: coverPath,
                bookLanguage: language,
              }}
            />
          )}
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
      </div>

      {/* Scrollable Table of contents.
          ponytail: ToC owns its own SmoothScrollArea so the book details +
          action buttons stay pinned above. pb-12 keeps the last item clear of
          the sidebar's bottom edge (matches the px-12 horizontal margin). */}
      {toc.length > 0 && (
        <SmoothScrollArea className="min-h-0 flex-1">
          <div className="pb-12 pt-6">
            <div className="py-1">
              {toc.map((item) => (
                <TocEntry
                  key={item.id || item.href}
                  item={item}
                  onNavigate={onNavigate}
                  level={0}
                  currentHref={activeHref}
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
        </SmoothScrollArea>
      )}
    </div>
  );
}

// ponytail: "Play from the start" — clears the playlist then plays the
// LLM-pinned readable-start section from the top. The sectionHref comes from
// BookMetadata.readableStartSectionHref (rootDir-prefixed, e.g. "OEBPS/Text/chap1.xhtml");
// the reader's ttsSectionMatches (basename compare) resolves it to the spine
// href, so we pass it straight through. Label resolved from the ToC by basename
// so the playlist item reads e.g. "Chapter 1" instead of a raw href.
function PlayFromStartButton({
  bookId,
  sectionHref,
  toc,
  bookMeta,
}: {
  bookId: string;
  sectionHref: string;
  toc: NavItem[];
  bookMeta: PlaylistBookMeta;
}) {
  const { playSection, clearPlaylist, playbackState } = useAudio();
  const [pending, setPending] = useState(false);
  // ponytail: clearPlaylist + playSection resolve as soon as the item is
  // queued, but startSection is fired un-awaited — so `pending` drops while
  // the Kokoro engine is still downloading its WASM model (multi-second,
  // silent). Stay "loading" until playback actually leaves the preparing
  // states, which also disables the button and prevents the double-click race
  // where the second click's clearPlaylist tears down the first's source.
  const isLoading =
    playbackState.state === "LOADING" ||
    playbackState.state === "GENERATING";

  // ponytail: basename compare mirrors ttsSectionMatches in audio-provider.ts.
  // ToC hrefs may carry #fragments or path prefixes the spine omits.
  const label = (() => {
    const target = sectionHref.split("/").pop()?.split("#")[0] ?? "";
    const walk = (items: NavItem[]): string | null => {
      for (const item of items) {
        const b = item.href.split("/").pop()?.split("#")[0] ?? "";
        if (b && b === target) return item.label;
        if (item.subitems?.length) {
          const found = walk(item.subitems);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(toc) ?? "Beginning";
  })();

  async function handleClick() {
    setPending(true);
    try {
      // ponytail: clear-all stops any current playback and wipes the queue so
      // "Play from the start" is unambiguous — the readable-start section
      // becomes the new active item, nothing before it.
      await clearPlaylist("all");
      await playSection(bookId, sectionHref, label, "now", undefined, bookMeta);
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="default"
      className="w-full gap-2"
      onClick={handleClick}
      disabled={pending || isLoading}
    >
      {pending || isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Play className="h-4 w-4" />
      )}
      {isLoading ? "Loading voice\u2026" : "Play from the start"}
    </Button>
  );
}
