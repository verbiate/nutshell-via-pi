"use client";

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Bookmark, ArrowUpRight, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface BookmarkItem {
  id: string;
  cfi: string;
  paragraphIndex: number;
  charOffset: number;
  selectedText: string | null;
  createdAt: string;
}

export interface BookmarkPanelProps {
  bookId: string;
  currentCfi?: string;
  onBookmarkClick: (cfi: string) => void;
  onSaveBookmark?: (cfi: string) => void;
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

export function BookmarkPanel({
  bookId,
  currentCfi,
  onBookmarkClick,
  onSaveBookmark,
}: BookmarkPanelProps) {
  const [open, setOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/reader/bookmarks?bookId=${encodeURIComponent(bookId)}`
      );
      if (res.ok) {
        const data = await res.json();
        setBookmarks(data.bookmarks ?? []);
      }
    } catch (err) {
      console.error("[BookmarkPanel] load failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/reader/bookmarks/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setBookmarks((prev) => prev.filter((b) => b.id !== id));
        toast.success("Bookmark removed");
      }
    } catch (err) {
      console.error("[BookmarkPanel] delete failed:", err);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Open bookmarks">
          <Bookmark className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[320px] sm:w-[360px] p-0">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle>Bookmarks</SheetTitle>
        </SheetHeader>
        {currentCfi && onSaveBookmark && (
          <div className="px-4 py-3 border-b border-border">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={() => {
                onSaveBookmark(currentCfi);
                toast.success("Bookmark saved");
              }}
            >
              <Bookmark className="h-4 w-4" />
              Bookmark this page
            </Button>
          </div>
        )}
        <ScrollArea className="h-[calc(100vh-56px)]">
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Loading...
            </div>
          )}
          {!loading && bookmarks.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="font-medium text-foreground">No bookmarks yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Tap the bookmark button while reading to save your place.
              </p>
            </div>
          )}
          {!loading && bookmarks.length > 0 && (
            <div className="divide-y divide-border/50">
              {bookmarks.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-3 px-4 py-3 group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {b.selectedText || "Bookmark"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatRelativeTime(b.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="h-7 w-7"
                    onClick={() => {
                      onBookmarkClick(b.cfi);
                      setOpen(false);
                    }}
                    aria-label="Go to bookmark location"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleDelete(b.id)}
                    aria-label="Remove bookmark"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
