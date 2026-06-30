"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { GripVertical, X, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlaylistItem } from "@/types/playlist";
import type { GhostItem } from "@/lib/reader/ghost";

export interface TtsQueueProps {
  items: PlaylistItem[];
  activeItemId: string | null;
  autoAdvanceBook: boolean;
  onReorder: (orderedIds: string[]) => void;
  onRemove: (itemId: string) => void;
  onClearAll: () => void;
  onClearUpcoming: () => void;
  onToggleAutoAdvance: (value: boolean) => void;
  onJumpToItem: (itemId: string) => void;
  /** Computed next readable segment; rendered as a pinned dashed card. */
  ghostItem?: GhostItem | null;
  /** Promote the ghost (behaves as skip). */
  onPlayGhost?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function BookSub({
  item,
  className,
}: {
  item: PlaylistItem;
  className?: string;
}) {
  if (!item.bookTitle) return null;
  return (
    <span className={cn("mt-0.5 block truncate text-xs", className)}>
      {item.bookTitle}
      {item.bookAuthor ? ` — ${item.bookAuthor}` : ""}
    </span>
  );
}

function QueueRow({
  item,
  isActive,
  onClick,
  onRemove,
  dragHandle,
}: {
  item: PlaylistItem;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
  dragHandle?: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors",
        isActive
          ? "bg-chocolate/10 font-medium text-chocolate"
          : "hover:bg-muted",
      )}
    >
      {dragHandle && (
        <span className="text-muted-foreground">{dragHandle}</span>
      )}
      <button
        type="button"
        onClick={onClick}
        className="flex-1 text-left min-w-0"
      >
        <span className="block line-clamp-2 leading-snug">
          {isActive && (
            <Volume2 className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />
          )}
          {item.sectionLabel || "Untitled section"}
        </span>
        <BookSub item={item} className="text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-foreground rounded-md p-1 transition-opacity shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

function SortableQueueRow({
  item,
  isActive,
  onClick,
  onRemove,
}: {
  item: PlaylistItem;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-50")}>
      <QueueRow
        item={item}
        isActive={isActive}
        onClick={onClick}
        onRemove={onRemove}
        dragHandle={
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab rounded p-0.5 hover:bg-muted-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        }
      />
    </div>
  );
}

function SectionLabel({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
      {typeof count === "number" && (
        <span className="ml-1 font-normal normal-case">({count})</span>
      )}
    </h4>
  );
}

export function TtsQueue({
  items,
  activeItemId,
  autoAdvanceBook,
  onReorder,
  onRemove,
  onClearAll,
  onClearUpcoming,
  onToggleAutoAdvance,
  onJumpToItem,
  ghostItem,
  onPlayGhost,
  open,
  onOpenChange,
}: TtsQueueProps) {
  const { active, upcoming } = useMemo(() => {
    const active = items.find((i) => i.status === "active") ?? null;
    const upcoming = items.filter((i) => i.status === "upcoming");
    return { active, upcoming };
  }, [items]);

  const activeRowRef = useRef<HTMLLIElement | null>(null);
  // Scroll the Now-Playing row into view on open. Component only mounts when open, so empty deps run once per open.
  useEffect(() => {
    const t = window.setTimeout(() => {
      activeRowRef.current?.scrollIntoView({ block: "nearest" });
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const upcomingIds = useMemo(() => upcoming.map((i) => i.id), [upcoming]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = upcomingIds.indexOf(active.id as string);
      const newIndex = upcomingIds.indexOf(over.id as string);
      const next = arrayMove(upcomingIds, oldIndex, newIndex);
      onReorder(next);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(80vh,600px)] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between pr-9">
            <DialogTitle>Playlist</DialogTitle>
            {items.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearAll}
                className="text-destructive hover:text-destructive"
              >
                Clear all
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 gap-3">
          <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
            {!active && upcoming.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing on deck.
                <br />
                Start reading to queue chapters.
              </p>
            )}

            {/* Now playing — highlighted hero row */}
            {active && (
              <div className="pt-1">
                <SectionLabel>Now playing</SectionLabel>
                <ul className="space-y-1">
                  <li
                    ref={activeRowRef}
                    className="group flex items-center gap-2 rounded-md border border-chocolate/20 bg-chocolate/10 px-3 py-3 text-sm font-medium text-chocolate"
                  >
                    <Volume2 className="h-4 w-4 shrink-0" />
                    <button
                      type="button"
                      onClick={() => onJumpToItem(active.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <span className="block line-clamp-2 leading-snug">
                        {active.sectionLabel || "Untitled section"}
                      </span>
                      <BookSub item={active} className="text-chocolate/70" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(active.id)}
                      aria-label="Remove"
                      className="text-chocolate/60 hover:text-chocolate rounded-md p-1 shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                </ul>
              </div>
            )}

            {/* Auto-advance ghost — computed next readable segment.
                Pinned on-deck, non-draggable; clicking it behaves as skip. */}
            {ghostItem && (
              <div className={cn(active && "mt-4")}>
                <SectionLabel>Up next</SectionLabel>
                <ul className="space-y-1">
                  <li
                    data-ghost
                    className="group flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
                  >
                    <Volume2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <button
                      type="button"
                      onClick={onPlayGhost}
                      className="flex-1 text-left min-w-0"
                    >
                      <span className="block line-clamp-2 leading-snug">
                        {ghostItem.sectionLabel || "Untitled section"}
                      </span>
                    </button>
                  </li>
                </ul>
              </div>
            )}

            {/* Up next */}
            {upcoming.length > 0 && (
              <div className={cn(active && "mt-4", ghostItem && "mt-2")}>
                <div className="mb-1 flex items-center justify-between">
                  <SectionLabel count={upcoming.length}>
                    {ghostItem ? "Queued" : "Up next"}
                  </SectionLabel>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClearUpcoming}
                    className="h-auto py-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear upcoming
                  </Button>
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={upcomingIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="space-y-1">
                      {upcoming.map((item) => (
                        <SortableQueueRow
                          key={item.id}
                          item={item}
                          isActive={item.id === activeItemId}
                          onClick={() => onJumpToItem(item.id)}
                          onRemove={() => onRemove(item.id)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </div>
            )}
          </ScrollArea>
          <div className="flex items-center gap-3 border-t pt-3">
            <Switch
              id="auto-advance"
              checked={autoAdvanceBook}
              onCheckedChange={onToggleAutoAdvance}
            />
            <Label
              htmlFor="auto-advance"
              className="text-sm text-muted-foreground cursor-pointer"
            >
              Automatically play next book segment
            </Label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
