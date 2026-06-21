"use client";

import { useMemo, useState } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  HIGHLIGHT_COLORS,
  highlightColorLabel,
  highlightSwatchStyle,
} from "./highlight-colors";

interface HighlightItem {
  id: string;
  cfi: string;
  paragraphIndex: number;
  selectedText: string;
  color: string;
  sectionHref: string | null;
  note: string | null;
  createdAt: string;
}

export interface HighlightsPanelProps {
  bookId: string;
  toc: NavItem[];
  onHighlightClick: (cfi: string) => void;
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

function dateBucket(dateStr: string): "today" | "week" | "earlier" {
  const date = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ms = date.getTime();
  if (ms >= startOfToday) return "today";
  if (ms >= startOfToday - 6 * 86400000) return "week";
  return "earlier";
}

const DATE_BUCKETS: { key: "today" | "week" | "earlier"; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "earlier", label: "Earlier" },
];

function HighlightRow({
  highlight,
  onNavigate,
  onDelete,
  onNoteSave,
}: {
  highlight: HighlightItem;
  onNavigate: (cfi: string) => void;
  onDelete: (id: string) => void;
  onNoteSave: (id: string, note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(highlight.note ?? "");

  const save = () => {
    onNoteSave(highlight.id, draft.trim());
    setEditing(false);
  };

  return (
    <div className="group flex gap-2 py-2 pl-12 pr-12">
      <div
        className="mt-0.5 w-1 shrink-0 self-stretch rounded-full"
        style={highlightSwatchStyle(highlight.color)}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => onNavigate(highlight.cfi)}
          className="block w-full text-left"
        >
          <p className="type-toc-section line-clamp-3 font-normal text-foreground">
            {highlight.selectedText}
          </p>
        </button>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          Paragraph {highlight.paragraphIndex}
        </p>

        {highlight.note && !editing && (
          <button
            onClick={() => {
              setDraft(highlight.note ?? "");
              setEditing(true);
            }}
            className="mt-1.5 flex w-full items-start gap-1.5 rounded-md bg-paper-deep px-2 py-1.5 text-left text-xs text-foreground"
          >
            <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="line-clamp-3">{highlight.note}</span>
          </button>
        )}

        {!highlight.note && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="mt-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            + Add note
          </button>
        )}

        {editing && (
          <div className="mt-1.5 flex flex-col gap-1.5">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a note…"
              rows={2}
              className="text-xs"
              autoFocus
            />
            <div className="flex gap-1.5">
              <Button size="sm" className="h-6 px-2 text-xs" onClick={save}>
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setEditing(false);
                  setDraft(highlight.note ?? "");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon-xs"
        className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={() => onDelete(highlight.id)}
        aria-label="Remove highlight"
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

function GroupBlock({
  label,
  count,
  swatch,
  items,
  onNavigate,
  onDelete,
  onNoteSave,
}: {
  label: string;
  count: number;
  swatch?: string;
  items: HighlightItem[];
  onNavigate: (cfi: string) => void;
  onDelete: (id: string) => void;
  onNoteSave: (id: string, note: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between px-12 pt-3 pb-1">
        <span className="flex items-center gap-1.5 truncate pr-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {swatch && (
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={highlightSwatchStyle(swatch)}
              aria-hidden
            />
          )}
          {label}
        </span>
        <span className="shrink-0 rounded-full bg-paper-deep px-1.5 text-[10px] font-medium text-foreground">
          {count}
        </span>
      </div>
      <div className="pb-1">
        {items.map((h) => (
          <HighlightRow
            key={h.id}
            highlight={h}
            onNavigate={onNavigate}
            onDelete={onDelete}
            onNoteSave={onNoteSave}
          />
        ))}
      </div>
    </div>
  );
}

export function HighlightsPanel({
  bookId,
  toc,
  onHighlightClick,
}: HighlightsPanelProps) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["highlights", bookId],
    queryFn: async () => {
      const res = await fetch(
        `/api/reader/highlights?bookId=${encodeURIComponent(bookId)}`
      );
      if (!res.ok) throw new Error("Failed to load highlights");
      return res.json() as Promise<{ highlights: HighlightItem[] }>;
    },
  });
  const highlights = data?.highlights ?? [];

  const flat = useMemo(() => flattenToc(toc), [toc]);
  const labelForHref = useMemo(() => {
    const m = new Map<string, string>();
    flat.forEach((f) => m.set(f.href, f.label));
    return m;
  }, [flat]);

  const dateGroups = useMemo(() => {
    const buckets: Record<string, HighlightItem[]> = {
      today: [],
      week: [],
      earlier: [],
    };
    for (const h of highlights) buckets[dateBucket(h.createdAt)].push(h);
    return DATE_BUCKETS.map((b) => ({
      label: b.label,
      items: buckets[b.key],
    })).filter((g) => g.items.length > 0);
  }, [highlights]);

  const chapterGroups = useMemo(() => {
    const byHref = new Map<string, HighlightItem[]>();
    const ungrouped: HighlightItem[] = [];
    for (const h of highlights) {
      const key = h.sectionHref ?? "";
      if (key && labelForHref.has(key)) {
        const arr = byHref.get(key) ?? [];
        arr.push(h);
        byHref.set(key, arr);
      } else {
        ungrouped.push(h);
      }
    }
    const ordered = flat
      .filter((f) => byHref.has(f.href))
      .map((f) => ({ label: f.label, items: byHref.get(f.href)! }));
    if (ungrouped.length)
      ordered.push({ label: "Highlights", items: ungrouped });
    return ordered;
  }, [highlights, flat, labelForHref]);

  const colorGroups = useMemo(() => {
    return HIGHLIGHT_COLORS.map((c) => ({
      label: highlightColorLabel(c.hex),
      swatch: c.hex,
      items: highlights.filter(
        (h) => h.color.toLowerCase() === c.hex.toLowerCase()
      ),
    })).filter((g) => g.items.length > 0);
  }, [highlights]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/reader/highlights/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["highlights", bookId] });
      }
    } catch (err) {
      console.error("[HighlightsPanel] delete failed:", err);
    }
  };

  const handleNoteSave = async (id: string, note: string) => {
    try {
      const res = await fetch(`/api/reader/highlights/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["highlights", bookId] });
      }
    } catch (err) {
      console.error("[HighlightsPanel] note save failed:", err);
    }
  };

  if (isLoading) {
    return (
      <div className="px-12 py-8 text-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (highlights.length === 0) {
    return (
      <div className="px-12 py-8 text-center">
        <p className="text-sm font-medium text-foreground">No highlights yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Select text while reading to highlight it.
        </p>
      </div>
    );
  }

  const renderGroups = (
    groups: { label: string; swatch?: string; items: HighlightItem[] }[]
  ) =>
    groups.map((g) => (
      <GroupBlock
        key={g.label + (g.swatch ?? "")}
        label={g.label}
        count={g.items.length}
        swatch={g.swatch}
        items={g.items}
        onNavigate={onHighlightClick}
        onDelete={handleDelete}
        onNoteSave={handleNoteSave}
      />
    ));

  return (
    <Tabs defaultValue="date" className="flex flex-col">
      <div className="px-12 pt-2">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="date">Date</TabsTrigger>
          <TabsTrigger value="chapter">Chapter</TabsTrigger>
          <TabsTrigger value="color">Color</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="date" className="mt-0">
        {renderGroups(dateGroups)}
      </TabsContent>
      <TabsContent value="chapter" className="mt-0">
        {renderGroups(chapterGroups)}
      </TabsContent>
      <TabsContent value="color" className="mt-0">
        {renderGroups(colorGroups)}
      </TabsContent>
    </Tabs>
  );
}
