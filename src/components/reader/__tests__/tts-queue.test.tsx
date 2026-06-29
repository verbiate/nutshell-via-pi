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

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, defaultValue }: { children: ReactNode; defaultValue: string }) => (
    <div data-tabs data-default={defaultValue}>{children}</div>
  ),
  TabsList: ({ children }: { children: ReactNode }) => (
    <div data-tabs-list>{children}</div>
  ),
  TabsTrigger: ({ children, value }: { children: ReactNode; value: string }) => (
    <div data-tabs-trigger data-value={value}>{children}</div>
  ),
  TabsContent: ({ children, value }: { children: ReactNode; value: string }) => (
    <div data-tabs-content data-value={value}>{children}</div>
  ),
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

function mkItem(over: Partial<PlaylistItem>): PlaylistItem {
  return {
    id: "x",
    userId: "u1",
    bookId: "b1",
    sectionHref: "ch1.xhtml",
    sectionLabel: "Chapter 1",
    position: 0,
    status: "history",
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
    const items = [mkItem({ id: "h1", status: "history" })];
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

describe("TtsQueue: tabs and counts", () => {
  it("renders both tab triggers with counts", () => {
    const items = [
      mkItem({ id: "a1", status: "active", position: 0 }),
      mkItem({ id: "u1", status: "upcoming", position: 1, sectionLabel: "Ch 2" }),
      mkItem({ id: "h1", status: "history", position: 2 }),
      mkItem({ id: "h2", status: "history", position: 3 }),
    ];
    const html = render(<TtsQueue items={items} {...baseProps} />);
    // ponytail: on-deck count = active(1) + upcoming(1) = 2; history = 2.
    expect(html).toContain("On deck");
    expect(html).toContain("Recently played");
    expect(html).toContain(">2<");
  });

  it("defaults to 'on-deck' when there is something on deck", () => {
    const items = [mkItem({ id: "a1", status: "active" })];
    const html = render(<TtsQueue items={items} {...baseProps} />);
    expect(html).toContain('data-default="on-deck"');
  });

  it("defaults to 'recently-played' when on deck is empty but history exists", () => {
    const items = [mkItem({ id: "h1", status: "history" })];
    const html = render(<TtsQueue items={items} {...baseProps} />);
    expect(html).toContain('data-default="recently-played"');
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

describe("TtsQueue: recently-played content", () => {
  it("renders history items in the recently-played tab", () => {
    const items = [
      mkItem({ id: "h1", status: "history", sectionLabel: "Old Chapter" }),
    ];
    const html = render(<TtsQueue items={items} {...baseProps} />);
    expect(html).toContain("Old Chapter");
  });

  it("shows an empty-state message when there is no history", () => {
    const html = render(<TtsQueue items={[]} {...baseProps} />);
    expect(html).toContain("No recently played chapters.");
  });
});