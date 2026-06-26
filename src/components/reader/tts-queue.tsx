"use client";

import { useMemo } from "react";
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
        className="flex-1 text-left line-clamp-2"
      >
        {isActive && (
          <Volume2 className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />
        )}
        {item.sectionLabel || "Untitled section"}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-foreground rounded-md p-1 transition-opacity"
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
  open,
  onOpenChange,
}: TtsQueueProps) {
  const { history, active, upcoming } = useMemo(() => {
    const history = items.filter((i) => i.status === "history");
    const active = items.find((i) => i.status === "active") ?? null;
    const upcoming = items.filter((i) => i.status === "upcoming");
    return { history, active, upcoming };
  }, [items]);

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
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Playlist</DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearAll}
              className="text-destructive hover:text-destructive"
            >
              Clear all
            </Button>
          </div>
        </DialogHeader>

        <div className="flex items-center justify-between py-2">
          <Label
            htmlFor="auto-advance"
            className="text-sm text-muted-foreground cursor-pointer"
          >
            Automatically play next book segment
          </Label>
          <Switch
            id="auto-advance"
            checked={autoAdvanceBook}
            onCheckedChange={onToggleAutoAdvance}
          />
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {items.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Your playlist is empty.
              <br />
              Start reading to add chapters.
            </p>
          )}

          {history.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                History
              </h4>
              <ul className="space-y-1">
                {history.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    isActive={false}
                    onClick={() => onJumpToItem(item.id)}
                    onRemove={() => onRemove(item.id)}
                  />
                ))}
              </ul>
            </div>
          )}

          {active && (
            <div className="mb-4">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Now playing
              </h4>
              <ul className="space-y-1">
                <QueueRow
                  item={active}
                  isActive
                  onClick={() => onJumpToItem(active.id)}
                  onRemove={() => onRemove(active.id)}
                />
              </ul>
            </div>
          )}

          {upcoming.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Up next
                </h4>
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
      </DialogContent>
    </Dialog>
  );
}
