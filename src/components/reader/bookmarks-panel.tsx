"use client";

import { useMemo } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BookmarkItem {
  id: string;
  cfi: string;
  paragraphIndex: number;
  charOffset: number;
  selectedText: string | null;
  sectionHref: string | null;
  createdAt: string;
}

export interface BookmarksPanelProps {
  bookId: string;
  currentCfi?: string;
  toc: NavItem[];
  onBookmarkClick: (cfi: string) => void;
  onSaveBookmark: (cfi: string) => Promise<void> | void;
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

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function BookmarksPanel({
  bookId,
  currentCfi,
  toc,
  onBookmarkClick,
  onSaveBookmark,
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
  // into a trailing "Bookmarks" bucket so nothing is silently dropped.
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
    byHref.forEach((arr) => arr.sort((a, b) => a.paragraphIndex - b.paragraphIndex));
    ungrouped.sort((a, b) => a.paragraphIndex - b.paragraphIndex);
    const ordered = flat
      .filter((f) => byHref.has(f.href))
      .map((f) => ({ label: f.label, items: byHref.get(f.href)! }));
    if (ungrouped.length) ordered.push({ label: "Bookmarks", items: ungrouped });
    return ordered;
  }, [bookmarks, flat, labelForHref]);

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
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-5 py-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={handleAdd}
          disabled={!currentCfi}
        >
          <BookmarkPlus className="h-4 w-4" />
          Add bookmark
        </Button>
      </div>

      {groups.length === 0 && (
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-medium text-foreground">No bookmarks yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Bookmark your place to jump back here later.
          </p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.label} className="border-t border-line">
          <div className="flex items-center justify-between px-5 pt-3 pb-1">
            <span className="truncate pr-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {g.label}
            </span>
            <span className="shrink-0 rounded-full bg-paper-deep px-1.5 text-[10px] font-medium text-foreground">
              {g.items.length}
            </span>
          </div>
          <div className="pb-1">
            {g.items.map((b) => (
              <div
                key={b.id}
                className="group flex items-center gap-2 py-2 pl-5 pr-2"
              >
                <button
                  onClick={() => onBookmarkClick(b.cfi)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm text-foreground">
                    {b.selectedText || "Bookmark"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatRelativeTime(b.createdAt)}
                  </p>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => handleDelete(b.id)}
                  aria-label="Remove bookmark"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
