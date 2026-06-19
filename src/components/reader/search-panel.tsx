"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchResult {
  paragraphIndex: number;
  snippet: string;
  cfi: string;
}

export interface SearchPanelProps {
  bookId: string;
  onResultClick: (paragraphIndex: number) => void;
}

export function SearchPanel({ bookId, onResultClick }: SearchPanelProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Fetch TXT once on panel open
  useEffect(() => {
    if (!open || text) return;
    setIsLoading(true);
    fetch(`/api/reader/txt?bookId=${encodeURIComponent(bookId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.text) setText(data.text);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [open, bookId, text]);

  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useMemo(() => {
    if (!text || debouncedQuery.length < 3) return [];
    const lines = text.split(/\n+/);
    const out: SearchResult[] = [];
    const q = debouncedQuery.toLowerCase();
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(q)) {
        const start = Math.max(0, line.toLowerCase().indexOf(q) - 40);
        const end = Math.min(
          line.length,
          line.toLowerCase().indexOf(q) + debouncedQuery.length + 40
        );
        out.push({
          paragraphIndex: idx,
          snippet: line.slice(start, end),
          cfi: "", // CFI mapping deferred — we will use paragraph offset
        });
      }
    });
    return out.slice(0, 50);
  }, [text, debouncedQuery]);

  const handleClick = useCallback(
    (result: SearchResult) => {
      onResultClick(result.paragraphIndex);
      setOpen(false);
    },
    [onResultClick]
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button aria-label="Search in book" className="h-[46px] w-[46px] bg-transparent text-foreground">
          <Search className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[320px] sm:w-[400px] p-0">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle>Search</SheetTitle>
        </SheetHeader>
        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search in book..."
              className="pl-9 pr-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                onClick={() => setQuery("")}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {query.length > 0 && query.length < 3 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Type at least 3 characters
            </p>
          )}
          {results.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <ScrollArea className="h-[calc(100vh-160px)]">
          {isLoading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Loading book text...
            </div>
          )}
          {!isLoading && !query && (
            <div className="px-4 py-8 text-center">
              <p className="font-medium text-foreground">Search this book</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Type a keyword to find passages in this book.
              </p>
            </div>
          )}
          {debouncedQuery.length >= 3 && results.length === 0 && !isLoading && (
            <div className="px-4 py-8 text-center">
              <p className="font-medium text-foreground">No matches found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try a different keyword or check your spelling.
              </p>
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={i}
              className="w-full text-left px-4 py-3 hover:bg-secondary transition-colors border-b border-border/50 last:border-0"
              onClick={() => handleClick(r)}
            >
              <p className="text-sm text-foreground line-clamp-2">
                <SearchSnippet text={r.snippet} match={debouncedQuery} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Paragraph {r.paragraphIndex + 1}
              </p>
            </button>
          ))}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function SearchSnippet({
  text,
  match,
}: {
  text: string;
  match: string;
}) {
  const parts = text.split(new RegExp(`(${escapeRegex(match)})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === match.toLowerCase() ? (
          <span key={i} className="search-match">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
