"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Lightbulb,
  MoreHorizontal,
  Pencil,
  Trash2,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface NoteItem {
  id: string;
  body: string;
  createdAt: string;
}

// ponytail: tagged union so the merged list can carry highlights and book-level
// notes in one structure, discriminated by `kind` for type-safe rendering.
type PanelItem = (HighlightItem & { kind: "highlight" }) | (NoteItem & { kind: "note" });

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

// ponytail: compact display date for standalone notes (which have no page/para).
// "Today" mirrors the date bucket; otherwise a locale short date.
function shortDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startOfToday) return "Today";
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { year: "numeric", month: "short", day: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}

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
        <DropdownMenuContent align="end" className="w-fit min-w-56 whitespace-nowrap">
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

function NoteRow({
  note,
  onDelete,
  onSave,
}: {
  note: NoteItem;
  onDelete: (id: string) => void;
  onSave: (id: string, body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);

  const save = () => {
    onSave(note.id, draft.trim());
    setEditing(false);
  };

  return (
    <div className="flex gap-2 py-2 pl-12 pr-12">
      <div
        className="mt-0.5 w-1 shrink-0 self-stretch rounded-full bg-muted-foreground/30"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        {!editing ? (
          <button
            onClick={() => {
              setDraft(note.body);
              setEditing(true);
            }}
            className="block w-full text-left"
          >
            <p className="type-toc-section line-clamp-3 whitespace-pre-wrap font-normal text-foreground">
              {note.body}
            </p>
          </button>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a note…"
              rows={3}
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
                  setDraft(note.body);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          {shortDate(note.createdAt)}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 w-8 shrink-0 rounded-full border border-line"
            aria-label="Note actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-fit min-w-56 whitespace-nowrap">
          <DropdownMenuItem
            onClick={() => {
              setDraft(note.body);
              setEditing(true);
            }}
          >
            <Pencil className="h-4 w-4" />
            Edit note
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDelete(note.id)}>
            <Trash2 className="h-4 w-4 text-destructive" />
            Delete note
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
  renderItem,
}: {
  label: string;
  count: number;
  swatch?: string;
  items: PanelItem[];
  isCollapsed: boolean;
  onToggle: () => void;
  renderItem: (item: PanelItem) => ReactNode;
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
        <div className="pb-1">{items.map(renderItem)}</div>
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
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState("");

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

  const { data: notesData } = useQuery({
    queryKey: ["notes", bookId],
    queryFn: async () => {
      const res = await fetch(
        `/api/reader/notes?bookId=${encodeURIComponent(bookId)}`
      );
      if (!res.ok) throw new Error("Failed to load notes");
      return res.json() as Promise<{ notes: NoteItem[] }>;
    },
  });
  const notes = notesData?.notes ?? [];

  const flat = useMemo(() => flattenToc(toc), [toc]);
  const labelForHref = useMemo(() => {
    const m = new Map<string, string>();
    flat.forEach((f) => m.set(f.href, f.label));
    return m;
  }, [flat]);

  const taggedHighlights = useMemo<PanelItem[]>(
    () => highlights.map((h) => ({ ...h, kind: "highlight" as const })),
    [highlights]
  );
  const taggedNotes = useMemo<PanelItem[]>(
    () => notes.map((n) => ({ ...n, kind: "note" as const })),
    [notes]
  );

  // ponytail: notes intermingle with highlights across every grouping view —
  // Date by createdAt, Chapter in a leading "Full Book" bucket, Color/Type as
  // their own type. No type filter; one grouping control.
  const merged = useMemo<PanelItem[]>(
    () => [...taggedHighlights, ...taggedNotes],
    [taggedHighlights, taggedNotes]
  );

  const dateGroups = useMemo(() => {
    const buckets: Record<string, PanelItem[]> = {
      today: [],
      week: [],
      earlier: [],
    };
    for (const it of merged) buckets[dateBucket(it.createdAt)].push(it);
    // ponytail: re-sort each bucket after merge — DB returns each list desc, but
    // the merged array isn't globally ordered.
    for (const k of Object.keys(buckets)) {
      buckets[k].sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)
      );
    }
    return DATE_BUCKETS.map((b) => ({
      label: b.label,
      items: buckets[b.key],
    })).filter((g) => g.items.length > 0);
  }, [merged]);

  const chapterGroups = useMemo(() => {
    const byHref = new Map<string, PanelItem[]>();
    const ungroupedHighlights: PanelItem[] = [];
    const noteItems: PanelItem[] = [];
    for (const it of merged) {
      if (it.kind === "note") {
        noteItems.push(it);
        continue;
      }
      const key = it.sectionHref ?? "";
      if (key && labelForHref.has(key)) {
        const arr = byHref.get(key) ?? [];
        arr.push(it);
        byHref.set(key, arr);
      } else {
        ungroupedHighlights.push(it);
      }
    }
    const ordered = flat
      .filter((f) => byHref.has(f.href))
      .map((f) => ({ label: f.label, items: byHref.get(f.href)! }));
    if (ungroupedHighlights.length)
      ordered.push({ label: "Highlights", items: ungroupedHighlights });
    // ponytail: book-level notes have no chapter — lead with a "Full Book"
    // bucket so they sit above the chapters, signalling they're about the whole
    // work rather than a specific passage.
    if (noteItems.length) ordered.unshift({ label: "Full Book", items: noteItems });
    return ordered;
  }, [merged, flat, labelForHref]);

  const colorGroups = useMemo(() => {
    const result: { label: string; swatch?: string; items: PanelItem[] }[] =
      HIGHLIGHT_COLORS.map((c) => ({
        label: highlightColorLabel(c.hex),
        swatch: c.hex,
        items: merged.filter(
          (it) => it.kind === "highlight" && it.color.toLowerCase() === c.hex.toLowerCase()
        ),
      })).filter((g) => g.items.length > 0);
    // ponytail: notes have no color — surface them as their own "type" bucket,
    // trailing the color groups (colors are the primary content of this view).
    const noteItems = merged.filter((it) => it.kind === "note");
    if (noteItems.length) result.push({ label: "Notes", items: noteItems });
    return result;
  }, [merged]);

  const handleDeleteHighlight = async (id: string) => {
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

  const handleDeleteNote = async (id: string) => {
    try {
      const res = await fetch(`/api/reader/notes/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["notes", bookId] });
      }
    } catch (err) {
      console.error("[HighlightsPanel] note delete failed:", err);
    }
  };

  const handleNoteUpdate = async (id: string, body: string) => {
    try {
      const res = await fetch(`/api/reader/notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["notes", bookId] });
      }
    } catch (err) {
      console.error("[HighlightsPanel] note update failed:", err);
    }
  };

  const handleAddNote = async (body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("/api/reader/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, body: trimmed }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["notes", bookId] });
      }
    } catch (err) {
      console.error("[HighlightsPanel] add note failed:", err);
    }
  };

  const renderItem = (item: PanelItem): ReactNode =>
    item.kind === "highlight" ? (
      <HighlightRow
        key={item.id}
        highlight={item}
        onNavigate={onHighlightClick}
        onDelete={handleDeleteHighlight}
        onNoteSave={handleNoteSave}
        onExplain={onExplain}
        bookId={bookId}
        bookMeta={bookMeta}
        labelForHref={labelForHref}
      />
    ) : (
      <NoteRow
        key={item.id}
        note={item}
        onDelete={handleDeleteNote}
        onSave={handleNoteUpdate}
      />
    );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-12 py-8 text-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  const renderGroups = (
    tab: string,
    groups: { label: string; swatch?: string; items: PanelItem[] }[]
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
          renderItem={renderItem}
        />
      ))}
    </div>
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="flex h-full flex-col"
    >
      {/*
        ponytail: fixed header — Add-a-note opens a modal composer (rendered
        below), and the Date/Chapter/Color grouping tabs stay pinned above the
        scroll area. Matches the Bookmarks/Discussions panel pattern.
      */}
      <div className="flex shrink-0 flex-col gap-3 px-12 pb-6">
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => setAddOpen(true)}
        >
          <StickyNote />
          Add a note
        </Button>

        {/* ponytail: Figma 698:347 — compact inline labels, not a filled tab bar.
         * DM Sans 16 medium uppercase; active gets a #b2a796 underline, inactive
         * rides opacity-60. Keeps Tabs root + TabsContent for state/content. */}
        {merged.length > 0 && (
          <div role="tablist" className="mt-6 flex items-center gap-4">
            {([
              ["date", "Date"],
              ["chapter", "Chapter"],
              ["color", "Color / Type"],
            ] as const).map(([value, label]) => {
              const active = activeTab === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(value)}
                  className={
                    "whitespace-nowrap py-1 font-sans text-[16px] font-medium uppercase leading-[1.35] text-foreground transition-opacity " +
                    (active
                      ? "border-b-2 border-[#b2a796]"
                      : "opacity-60 hover:opacity-100")
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <SmoothScrollArea className="min-h-0 flex-1">
        <div className="pb-12 pt-6">
          {merged.length === 0 ? (
            <div className="px-2 py-8 text-center">
              <p className="text-sm font-medium text-foreground">No notes or highlights yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add a note above, or select text while reading to highlight it.
              </p>
            </div>
          ) : (
            <>
              <TabsContent value="date" className="mt-0">
                {renderGroups("date", dateGroups)}
              </TabsContent>
              <TabsContent value="chapter" className="mt-0">
                {renderGroups("chapter", chapterGroups)}
              </TabsContent>
              <TabsContent value="color" className="mt-0">
                {renderGroups("color", colorGroups)}
              </TabsContent>
            </>
          )}
        </div>
      </SmoothScrollArea>

      {/*
        ponytail: modal composer for book-level notes. Radix portals to <body>,
        so nesting inside Tabs is fine. Cmd/Ctrl+Enter saves; Esc, overlay, or
        Cancel close and clear the draft.
      */}
      <Dialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) setDraft("");
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add a note</DialogTitle>
          </DialogHeader>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a note…"
            rows={5}
            className="text-sm"
            autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && draft.trim()) {
                handleAddNote(draft);
                setDraft("");
                setAddOpen(false);
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!draft.trim()}
              onClick={() => {
                handleAddNote(draft);
                setDraft("");
                setAddOpen(false);
              }}
            >
              Save note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
