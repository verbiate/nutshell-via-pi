"use client";

import { useMemo, useState } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Lightbulb,
  MoreHorizontal,
  Trash2,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PlaySectionMenuItems } from "@/components/audio/play-section-menu";
import type { PlaylistBookMeta } from "@/types/playlist";
import {
  HIGHLIGHT_COLORS,
  highlightColorLabel,
  highlightSwatchStyle,
} from "./highlight-colors";

interface HighlightItem {
  id: string;
  cfi: string;
  paragraphIndex: number;
  pageNumber: number | null;
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
  onExplain: (cfi: string, selectedText: string) => void;
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
  onExplain,
  bookId,
  bookMeta,
  labelForHref,
}: {
  highlight: HighlightItem;
  onNavigate: (cfi: string) => void;
  onDelete: (id: string) => void;
  onNoteSave: (id: string, note: string) => void;
  onExplain: (cfi: string, selectedText: string) => void;
  bookId: string;
  bookMeta?: PlaylistBookMeta;
  labelForHref: Map<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(highlight.note ?? "");

  const save = () => {
    onNoteSave(highlight.id, draft.trim());
    setEditing(false);
  };

  return (
    <div className="flex gap-2 py-2 pl-12 pr-12">
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
          {highlight.pageNumber != null
            ? `Page ${highlight.pageNumber}`
            : `Paragraph ${highlight.paragraphIndex}`}
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 w-8 shrink-0 rounded-full border border-line"
            aria-label="Highlight actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem
            onClick={() => onExplain(highlight.cfi, highlight.selectedText)}
          >
            <Lightbulb className="h-4 w-4 text-lav" />
            Ask about this
          </DropdownMenuItem>
          {highlight.sectionHref && (
            <>
              <DropdownMenuSeparator />
              <PlaySectionMenuItems
                bookId={bookId}
                sectionHref={highlight.sectionHref}
                sectionLabel={
                  labelForHref.get(highlight.sectionHref) || "Reading"
                }
                startPos={{ startCfi: highlight.cfi }}
                bookMeta={bookMeta}
              />
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onDelete(highlight.id)}>
            <Trash2 className="h-4 w-4 text-destructive" />
            Delete highlight
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function GroupBlock({
  label,
  count,
  swatch,
  items,
  isCollapsed,
  onToggle,
  onNavigate,
  onDelete,
  onNoteSave,
  onExplain,
  bookId,
  bookMeta,
  labelForHref,
}: {
  label: string;
  count: number;
  swatch?: string;
  items: HighlightItem[];
  isCollapsed: boolean;
  onToggle: () => void;
  onNavigate: (cfi: string) => void;
  onDelete: (id: string) => void;
  onNoteSave: (id: string, note: string) => void;
  onExplain: (cfi: string, selectedText: string) => void;
  bookId: string;
  bookMeta?: PlaylistBookMeta;
  labelForHref: Map<string, string>;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      {/*
        ponytail: matches Bookmarks chapter header — 30px tall, type-section-label
        (DM Sans 14/600), border-b flush with the row, circular outline count
        badge, collapsible chevron. Keeps the two tabs visually consistent.
      */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        className="flex h-[30px] w-full items-center gap-2 border-b border-line/50 px-12 text-left"
      >
        <ChevronDown
          className={cn(
            "h-[14px] w-[14px] shrink-0 text-foreground transition-transform",
            isCollapsed && "-rotate-90"
          )}
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate pr-2 type-section-label text-foreground"
        >
          {swatch && (
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={highlightSwatchStyle(swatch)}
              aria-hidden
            />
          )}
          <span className="truncate">{label}</span>
        </span>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] font-medium tabular-nums text-foreground"
        >
          {count}
        </span>
      </button>
      {!isCollapsed && (
        <div className="pb-1">
          {items.map((h) => (
            <HighlightRow
              key={h.id}
              highlight={h}
              onNavigate={onNavigate}
              onDelete={onDelete}
              onNoteSave={onNoteSave}
              onExplain={onExplain}
              bookId={bookId}
              bookMeta={bookMeta}
              labelForHref={labelForHref}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function HighlightsPanel({
  bookId,
  toc,
  onHighlightClick,
  onExplain,
  bookMeta,
}: HighlightsPanelProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("date");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groupKey = (
    tab: string,
    g: { label: string; swatch?: string }
  ) => `${tab}-${g.label}-${g.swatch ?? ""}`;
  const toggleGroup = (
    tab: string,
    g: { label: string; swatch?: string }
  ) =>
    setCollapsed((prev) => {
      const key = groupKey(tab, g);
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
    tab: string,
    groups: { label: string; swatch?: string; items: HighlightItem[] }[]
  ) => (
    <div className="flex flex-col gap-2">
      {groups.map((g) => (
        <GroupBlock
          key={g.label + (g.swatch ?? "")}
          label={g.label}
          count={g.items.length}
          swatch={g.swatch}
          items={g.items}
          isCollapsed={collapsed.has(groupKey(tab, g))}
          onToggle={() => toggleGroup(tab, g)}
          onNavigate={onHighlightClick}
          onDelete={handleDelete}
          onNoteSave={handleNoteSave}
          onExplain={onExplain}
          bookId={bookId}
          bookMeta={bookMeta}
          labelForHref={labelForHref}
        />
      ))}
    </div>
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="flex flex-col gap-9"
    >
      <div className="px-12">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="date">Date</TabsTrigger>
          <TabsTrigger value="chapter">Chapter</TabsTrigger>
          <TabsTrigger value="color">Color</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="date" className="mt-0">
        {renderGroups("date", dateGroups)}
      </TabsContent>
      <TabsContent value="chapter" className="mt-0">
        {renderGroups("chapter", chapterGroups)}
      </TabsContent>
      <TabsContent value="color" className="mt-0">
        {renderGroups("color", colorGroups)}
      </TabsContent>
    </Tabs>
  );
}
