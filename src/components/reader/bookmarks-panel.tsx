"use client";

import { useMemo, useState } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, ChevronDown, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { SmoothScrollArea } from "@/components/library/smooth-scroll-area";
import { PlaySectionMenuItems } from "@/components/audio/play-section-menu";
import type { PlaylistBookMeta } from "@/types/playlist";

interface BookmarkItem {
  id: string;
  cfi: string;
  paragraphIndex: number;
  charOffset: number;
  pageNumber: number | null;
  sectionHref: string | null;
  createdAt: string;
}

export interface BookmarksPanelProps {
  bookId: string;
  currentCfi?: string;
  toc: NavItem[];
  onBookmarkClick: (cfi: string) => void;
  onSaveBookmark: (cfi: string) => Promise<void> | void;
  bookMeta?: PlaylistBookMeta;
}

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

export function BookmarksPanel({
  bookId,
  currentCfi,
  toc,
  onBookmarkClick,
  onSaveBookmark,
  bookMeta,
}: BookmarksPanelProps) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["bookmarks", bookId],
    queryFn: async () => {
      const res = await fetch(
        `/api/reader/bookmarks?bookId=${encodeURIComponent(bookId)}`
      );
      if (!res.ok) throw new Error("Failed to load bookmarks");
      return res.json() as Promise<{ bookmarks: BookmarkItem[] }>;
    },
  });
  const bookmarks = data?.bookmarks ?? [];

  const flat = useMemo(() => flattenToc(toc), [toc]);
  const labelForHref = useMemo(() => {
    const m = new Map<string, string>();
    flat.forEach((f) => m.set(f.href, f.label));
    return m;
  }, [flat]);

  // ponytail: group by section, ordered by TOC position; unknown sections fall
  // into a trailing "Bookmarks" bucket so nothing is silently dropped. Sort by
  // pageNumber (epub.js location) — falls back to paragraphIndex for legacy
  // rows captured before pageNumber existed.
  const groups = useMemo(() => {
    const byHref = new Map<string, BookmarkItem[]>();
    const ungrouped: BookmarkItem[] = [];
    for (const b of bookmarks) {
      const key = b.sectionHref ?? "";
      if (key && labelForHref.has(key)) {
        const arr = byHref.get(key) ?? [];
        arr.push(b);
        byHref.set(key, arr);
      } else {
        ungrouped.push(b);
      }
    }
    const rank = (b: BookmarkItem) => b.pageNumber ?? b.paragraphIndex;
    byHref.forEach((arr) => arr.sort((a, b) => rank(a) - rank(b)));
    ungrouped.sort((a, b) => rank(a) - rank(b));
    const ordered = flat
      .filter((f) => byHref.has(f.href))
      .map((f) => ({ label: f.label, items: byHref.get(f.href)! }));
    if (ungrouped.length) ordered.push({ label: "Bookmarks", items: ungrouped });
    return ordered;
  }, [bookmarks, flat, labelForHref]);

  // ponytail: collapse state is in-memory React state (no persistence). Resets
  // when the panel unmounts. Default all-expanded so a fresh open shows every
  // bookmark; derive the initial set from the current groups.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (label: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/reader/bookmarks/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["bookmarks", bookId] });
      }
    } catch (err) {
      console.error("[BookmarksPanel] delete failed:", err);
    }
  };

  // ponytail: await the POST before invalidating — otherwise the refetch
  // races the write and re-caches an empty list.
  const handleAdd = async () => {
    if (!currentCfi) return;
    await onSaveBookmark(currentCfi);
    queryClient.invalidateQueries({ queryKey: ["bookmarks", bookId] });
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-12 py-8 text-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/*
        ponytail: fixed header — "Add bookmark" stays pinned above the scroll
        area so it's always reachable. Matches the Discussions panel pattern.
      */}
      <div className="flex shrink-0 flex-col pb-6">
        <div className="px-12">
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={handleAdd}
            disabled={!currentCfi}
          >
            <BookmarkPlus />
            Add bookmark
          </Button>
        </div>
      </div>

      {/*
        ponytail: scrollable groups list. Empty state renders inline; pb-12
        keeps the last item clear of the sidebar's bottom edge.
      */}
      <SmoothScrollArea className="min-h-0 flex-1">
        {groups.length === 0 ? (
          <div className="px-12 py-8 text-center">
            <p className="text-sm font-medium text-foreground">No bookmarks yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Bookmark your place to jump back here later.
            </p>
          </div>
        ) : (
          <div className="pb-12 pt-6">
            {/*
              ponytail: chapter groups packed at 8px (Figma spec). The outer gap-9
              still separates the "Add bookmark" button from the list as a section;
              this inner gap-2 is the between-section spacing from the mockup.
            */}
            <div className="flex flex-col gap-2">
              {groups.map((g) => {
                const isCollapsed = collapsed.has(g.label);
                return (
                  <div key={g.label}>
                    {/*
                      ponytail: 30px-tall section header with a border-b flush against
                      the row (Figma spec). The first list item has no top divider, so
                      this border-b is the only line between header and first item — no
                      double line.
                    */}
                    <button
                      type="button"
                      onClick={() => toggle(g.label)}
                      aria-expanded={!isCollapsed}
                      className="flex h-[30px] w-full items-center gap-2 border-b border-line/50 px-12 text-left"
                    >
                      <ChevronDown
                        className={cn(
                          "h-[14px] w-[14px] shrink-0 text-foreground transition-transform",
                          isCollapsed && "-rotate-90"
                        )}
                      />
                      <span className="type-section-label flex-1 truncate text-foreground">
                        {g.label}
                      </span>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] font-medium tabular-nums text-foreground">
                        {g.items.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="divide-y divide-line/50">
                        {g.items.map((b) => (
                          <div
                            key={b.id}
                            className="flex items-center gap-2 px-12 py-3"
                          >
                            <button
                              onClick={() => onBookmarkClick(b.cfi)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <p className="type-toc-section font-normal text-foreground">
                                {b.pageNumber != null
                                  ? `Page ${b.pageNumber}`
                                  : "Bookmark"}
                              </p>
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                {/*
                                  ponytail: always-visible circular outline trigger
                                  (Figma mockup). Was hover-revealed ghost; mockup
                                  shows it persistent at all widths.
                                */}
                                <Button
                                  variant="ghost"
                                  className="h-8 w-8 shrink-0 rounded-full border border-line"
                                  aria-label="Bookmark actions"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="min-w-52">
                                {b.sectionHref && (
                                  <PlaySectionMenuItems
                                    bookId={bookId}
                                    sectionHref={b.sectionHref}
                                    sectionLabel={
                                      labelForHref.get(b.sectionHref) ||
                                      "Reading"
                                    }
                                    startPos={{ startCfi: b.cfi }}
                                    bookMeta={bookMeta}
                                  />
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleDelete(b.id)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                  Delete bookmark
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SmoothScrollArea>
    </div>
  );
}
