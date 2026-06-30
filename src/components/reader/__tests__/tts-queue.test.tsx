// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

// ponytail: SSR mocks — radix Dialog/Tabs/ScrollArea use portals/contexts that
// don't render during renderToStaticMarkup. Pass children through so we can
// assert labels and structure.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div data-dialog-content>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (v: boolean) => void }) => (
    <input type="checkbox" checked={checked} readOnly data-switch onChange={() => onCheckedChange?.(!checked)} />
  ),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  closestCenter: () => null,
  KeyboardSensor: class {},
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => ({}),
}));

vi.mock("@dnd-kit/sortable", () => ({
  arrayMove: (arr: string[]) => arr,
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: () => null,
  verticalListSortingStrategy: () => null,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}));

import { TtsQueue } from "../tts-queue";
import type { PlaylistItem } from "@/types/playlist";
import type { GhostItem } from "@/lib/reader/ghost";

function mkItem(over: Partial<PlaylistItem>): PlaylistItem {
  return {
    id: "x",
    userId: "u1",
    bookId: "b1",
    sectionHref: "ch1.xhtml",
    sectionLabel: "Chapter 1",
    position: 0,
    status: "upcoming",
    bookTitle: "Test Book",
    bookAuthor: null,
    bookCoverPath: null,
    bookLanguage: "en",
    addedAt: "2026-01-01T00:00:00.000Z",
    playedAt: null,
    ...over,
  };
}

const noop = () => {};
const baseProps = {
  activeItemId: null,
  autoAdvanceBook: true,
  ghostItem: null,
  onPlayGhost: noop,
  onReorder: noop,
  onRemove: noop,
  onClearAll: noop,
  onClearUpcoming: noop,
  onToggleAutoAdvance: noop,
  onJumpToItem: noop,
  open: true,
  onOpenChange: noop,
};

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

describe("TtsQueue: header", () => {
  it("renders the Playlist title", () => {
    const html = render(<TtsQueue items={[]} {...baseProps} />);
    expect(html).toContain("Playlist");
  });

  it("hides 'Clear all' when there are no items", () => {
    const html = render(<TtsQueue items={[]} {...baseProps} />);
    expect(html).not.toContain("Clear all");
  });

  it("shows 'Clear all' when items exist", () => {
    const items = [mkItem({ id: "u1", status: "upcoming" })];
    const html = render(<TtsQueue items={items} {...baseProps} />);
    expect(html).toContain("Clear all");
  });
});

describe("TtsQueue: auto-advance toggle", () => {
  it("renders the auto-advance label and reflects checked state", () => {
    const html = render(
      <TtsQueue items={[]} {...baseProps} autoAdvanceBook={true} />,
    );
    expect(html).toContain("Automatically play next book segment");
    expect(html).toContain('checked=""');
  });

  it("reflects unchecked state", () => {
    const html = render(
      <TtsQueue items={[]} {...baseProps} autoAdvanceBook={false} />,
    );
    expect(html).not.toContain('checked=""');
  });
});

describe("TtsQueue: on-deck content", () => {
  it("renders the active item as 'Now playing' highlighted hero row", () => {
    const items = [
      mkItem({ id: "a1", status: "active", sectionLabel: "Active Chapter" }),
    ];
    const html = render(<TtsQueue items={items} {...baseProps} />);
    expect(html).toContain("Now playing");
    expect(html).toContain("Active Chapter");
    expect(html).toContain("bg-chocolate/10");
  });

  it("renders upcoming items with 'Up next' label and count", () => {
    const items = [
      mkItem({ id: "a1", status: "active", position: 0 }),
      mkItem({ id: "u1", status: "upcoming", position: 1, sectionLabel: "Next Chapter" }),
    ];
    const html = render(<TtsQueue items={items} {...baseProps} />);
    expect(html).toContain("Up next");
    expect(html).toContain("Next Chapter");
  });

  it("shows an empty-state message when nothing is on deck", () => {
    const html = render(<TtsQueue items={[]} {...baseProps} />);
    expect(html).toContain("Nothing on deck.");
  });
});

describe("TtsQueue: ghost card", () => {
  const ghost: GhostItem = {
    sectionHref: "ch2.xhtml",
    sectionLabel: "Chapter 2",
  };
  const active = mkItem({ id: "a1", status: "active", position: 0 });

  it("renders nothing ghost-related when ghostItem is null", () => {
    const html = render(
      <TtsQueue items={[active]} {...baseProps} ghostItem={null} />,
    );
    expect(html).not.toContain("data-ghost");
  });

  it("renders the ghost section label between active and upcoming", () => {
    const html = render(
      <TtsQueue items={[active]} {...baseProps} ghostItem={ghost} />,
    );
    expect(html).toContain("Chapter 2");
    expect(html).toContain("data-ghost");
  });

  it("renders the ghost even when a manual upcoming item exists (option c)", () => {
    const upcoming = mkItem({
      id: "u1",
      status: "upcoming",
      position: 1,
      sectionLabel: "Chapter 2",
    });
    const html = render(
      <TtsQueue
        items={[active, upcoming]}
        {...baseProps}
        ghostItem={ghost}
      />,
    );
    // Both the dashed ghost and the solid manual row carry the label.
    expect(html.match(/Chapter 2/g)?.length).toBe(2);
  });
});