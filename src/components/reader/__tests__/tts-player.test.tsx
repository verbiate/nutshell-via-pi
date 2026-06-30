// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactNode } from "react";

// ponytail: SSR mocks — radix Select/Tooltip/Dialog use portals that don't render
// during renderToStaticMarkup. Pass children through so we can assert labels.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children, ...rest }: any) => (
    <div data-trigger {...rest}>{children}</div>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: any) => (
    <div data-value={value}>{children}</div>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <span data-tooltip>{children}</span>
  ),
}));

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

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked }: { checked?: boolean }) => (
    <input type="checkbox" checked={checked} readOnly />
  ),
}));

// ponytail: TtsPlayer calls useRouter/usePathname at render; bare SSR has no
// App Router context, so stub them. pathnameRef lets interaction tests set the
// current route.
const pathnameRef = vi.hoisted(() => ({ current: null as string | null }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ push: vi.fn() }),
}));

// ponytail: TtsPlayer only reads `openAudioSettings` from useAudio now — the
// Audio Settings modal lives in AudioProvider, not here. Stub the context with
// the minimum the component touches so we can assert "click gear → open modal".
const audioStub = vi.hoisted(() => ({
  openAudioSettings: vi.fn(),
}));
vi.mock("@/components/audio/audio-context", () => ({
  useAudio: () => audioStub,
}));

import { TtsPlayer } from "../tts-player";
import type { TtsPlaybackState } from "@/hooks/use-tts-playback";
import type { PlaylistItem } from "@/types/playlist";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

const idleState: TtsPlaybackState = {
  state: "IDLE",
  sectionTitle: "",
  sectionHref: "",
  audioUrl: null,
  audioId: null,
  currentTime: 0,
  duration: 0,
};

const playingState: TtsPlaybackState = {
  ...idleState,
  state: "PLAYING",
  sectionTitle: "Chapter 1",
  duration: 120,
  currentTime: 30,
};

const loadingState: TtsPlaybackState = {
  ...idleState,
  state: "LOADING",
  sectionTitle: "Chapter 1",
};

const baseProps = {
  onPlayPause: () => {},
  onStop: () => {},
  onScrub: () => {},
};

function mkPlayer(overrides: Partial<Parameters<typeof TtsPlayer>[0]> = {}) {
  return (
    <TtsPlayer
      state={playingState}
      {...baseProps}
      {...overrides}
    />
  );
}

describe("TtsPlayer: floating card", () => {
  it("renders as a rounded floating card anchored in the book area", () => {
    const html = render(mkPlayer());
    expect(html).toContain("max-w-[640px]");
    expect(html).toContain("rounded-xl");
    expect(html).toContain("shadow-card");
  });

  it("renders fully visible by default (no hidden prop)", () => {
    // ponytail: with no `hidden` prop the card is fully visible — no opacity-0 /
    // translate-y-4 hiding. The minimize toggle collapses to a mini form instead
    // of unmounting. Idle-fade is the caller's job (reader-client passes
    // hidden={ttsHidden}); the default stays opaque.
    // (Don't assert on pointer-events-none: radix Slider emits disabled:pointer-events-none
    // as a substring inside the player, unrelated to root visibility.)
    const html = render(mkPlayer({ state: idleState }));
    expect(html).not.toContain("opacity-0");
    expect(html).not.toContain("translate-y-4");
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Audio player"');
  });

  it("fades out when hidden={true} is passed (idle-fade)", () => {
    const html = render(mkPlayer({ state: idleState, hidden: true }));
    expect(html).toContain("opacity-0");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("TtsPlayer: playback controls", () => {
  it("still renders play/pause, minimize, and settings buttons", () => {
    const html = render(mkPlayer());
    expect(html).toContain('aria-label="Pause"');
    expect(html).toContain('aria-label="Minimize audio player"');
    expect(html).toContain('aria-label="Audio settings"');
  });

  it("shows the section title and optional book metadata", () => {
    const html = render(
      mkPlayer({
        state: { ...playingState, sectionTitle: "Chapter 5" },
        bookTitle: "Measure What Matters",
        bookAuthor: "John Doerr",
      }),
    );
    expect(html).toContain("Chapter 5");
    expect(html).toContain("Measure What Matters");
    expect(html).toContain("John Doerr");
  });
});

describe("TtsPlayer: Audio Settings entrypoint", () => {
  it("clicking the gear icon invokes openAudioSettings (the modal lives upstream)", () => {
    audioStub.openAudioSettings.mockClear();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(mkPlayer());
    });

    const gear = container.querySelector(
      'button[aria-label="Audio settings"]',
    ) as HTMLButtonElement;
    expect(gear).toBeTruthy();
    act(() => gear.click());
    expect(audioStub.openAudioSettings).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });
});

describe("TtsPlayer: model-load progress", () => {
  it("shows the progress bar with rounded pct while LOADING", () => {
    const html = render(
      mkPlayer({ state: loadingState, loadPct: 42.7 }),
    );
    expect(html).toContain("Loading voice model");
    expect(html).toContain("43%");
    expect(html).toContain("progressbar");
    expect(html).toContain("width:42.7%");
  });

  it("hides the progress bar when not loading", () => {
    const html = render(mkPlayer({ state: playingState, loadPct: 42 }));
    expect(html).not.toContain("Loading voice model");
  });
});

describe("TtsPlayer: scrubber + time readout", () => {
  it("shows the time readout when duration is known", () => {
    // playingState has currentTime 30, duration 120 → 0:30 / 2:00.
    const html = render(mkPlayer());
    expect(html).toContain("0:30 / 2:00");
  });

  it("hides the time readout when duration is 0 (speechSynthesis fallback)", () => {
    const html = render(
      mkPlayer({ state: { ...idleState, state: "READY", duration: 0 } }),
    );
    expect(html).not.toMatch(/0:00 \//);
  });

  it("disables the scrubber when canScrub is false (free engines)", () => {
    const html = render(mkPlayer());
    const slider = html.match(/<span[^>]*data-slot="slider"[^>]*>/)?.[0] ?? "";
    expect(slider).toContain('aria-disabled="true"');
  });

  it("enables the scrubber when canScrub is true and duration is known", () => {
    const html = render(mkPlayer({ canScrub: true }));
    const slider = html.match(/<span[^>]*data-slot="slider"[^>]*>/)?.[0] ?? "";
    expect(slider).not.toContain('aria-disabled="true"');
  });
});

describe("TtsPlayer: playlist queue", () => {
  const queueItems: PlaylistItem[] = [
    {
      id: "i1",
      userId: "u1",
      kind: "section",
      bookId: "b1",
      sectionHref: "ch1.xhtml",
      sectionLabel: "Chapter 1",
      text: null,
      position: 0,
      status: "history",
      bookTitle: "Test Book",
      bookAuthor: null,
      bookCoverPath: null,
      bookLanguage: "en",
      addedAt: "2026-01-01T00:00:00.000Z",
      playedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "i2",
      userId: "u1",
      kind: "section",
      bookId: "b1",
      sectionHref: "ch2.xhtml",
      sectionLabel: "Chapter 2",
      text: null,
      position: 1,
      status: "active",
      bookTitle: "Test Book",
      bookAuthor: null,
      bookCoverPath: null,
      bookLanguage: "en",
      addedAt: "2026-01-01T00:00:00.000Z",
      playedAt: null,
    },
  ];

  it("shows a playlist button when queueItems + onJumpToItem are provided", () => {
    const html = render(
      mkPlayer({
        queueItems,
        onJumpToItem: () => {},
      }),
    );
    expect(html).toContain('aria-label="Playlist"');
  });

  it("hides the playlist button when no onJumpToItem is provided", () => {
    const html = render(mkPlayer());
    expect(html).not.toContain('aria-label="Playlist"');
  });

  it("renders the playlist dialog with the active item highlighted", () => {
    const html = render(
      mkPlayer({
        queueItems,
        activeItemId: "i2",
        onJumpToItem: () => {},
      }),
    );
    expect(html).toContain("Chapter 1");
    expect(html).toContain("Chapter 2");
    expect(html).toContain("bg-chocolate/10");
  });
});

describe("TtsPlayer: idle (nothing loaded) state", () => {
  it("shows the 'Start reading from here' prompt when IDLE", () => {
    const html = render(mkPlayer({ state: idleState }));
    expect(html).toContain("Start reading from here");
  });

  it("main button is labeled 'Read aloud' when IDLE", () => {
    const html = render(mkPlayer({ state: idleState }));
    expect(html).toContain('aria-label="Read aloud"');
  });

  it("hides the Stop button when IDLE (nothing to stop)", () => {
    const html = render(mkPlayer({ state: idleState }));
    expect(html).not.toContain('aria-label="Stop"');
  });

  it("main button is 'Pause' and Stop is visible while PLAYING", () => {
    const html = render(mkPlayer()); // playingState
    expect(html).toContain('aria-label="Pause"');
    expect(html).toContain('aria-label="Stop"');
  });

  it("main button is 'Resume' when PAUSED/READY", () => {
    const html = render(
      mkPlayer({ state: { ...playingState, state: "READY" } }),
    );
    expect(html).toContain('aria-label="Resume"');
  });

  it("shows 'Play next section' prompt when ENDED (section complete)", () => {
    const html = render(
      mkPlayer({ state: { ...playingState, state: "ENDED" } }),
    );
    expect(html).toContain("Play next section");
  });

  it("main button is labeled 'Play next section' when ENDED", () => {
    const html = render(
      mkPlayer({ state: { ...playingState, state: "ENDED" } }),
    );
    expect(html).toContain('aria-label="Play next section"');
  });

  it("shows 'Book finished' and an inert heart when bookFinished is set", () => {
    const html = render(
      mkPlayer({ state: idleState, bookFinished: true }),
    );
    expect(html).toContain("Book finished");
    expect(html).toContain('aria-label="Finished"');
    // ponytail: shadcn Button surfaces `disabled` as the HTML attribute.
    expect(html).toMatch(/disabled(?:=|"")/);
  });

  it("hides book-meta sub-title when ENDED or bookFinished", () => {
    const ended = render(
      mkPlayer({
        state: { ...playingState, state: "ENDED" },
        bookTitle: "My Book",
        bookAuthor: "Author",
      }),
    );
    expect(ended).toContain("Play next section");
    expect(ended).not.toContain("My Book");

    const finished = render(
      mkPlayer({
        state: idleState,
        bookFinished: true,
        bookTitle: "My Book",
        bookAuthor: "Author",
      }),
    );
    expect(finished).toContain("Book finished");
    expect(finished).not.toContain("My Book");
  });
});

describe("TtsPlayer: skip-ahead button", () => {
  it("renders when canSkipAhead && onSkipNext while playback is active", () => {
    const html = render(
      mkPlayer({
        canSkipAhead: true,
        onSkipNext: () => {},
      }),
    );
    expect(html).toContain('aria-label="Skip ahead"');
  });

  it("hides when canSkipAhead is false", () => {
    const html = render(
      mkPlayer({
        canSkipAhead: false,
        onSkipNext: () => {},
      }),
    );
    expect(html).not.toContain('aria-label="Skip ahead"');
  });

  it("hides when onSkipNext is missing even if canSkipAhead is true", () => {
    const html = render(mkPlayer({ canSkipAhead: true }));
    expect(html).not.toContain('aria-label="Skip ahead"');
  });

  it("hides when collapsed", () => {
    // collapsed is internal state toggled by the minimize button; start IDLE
    // (where the collapsed affordance is reachable) and click minimize to
    // collapse, then verify the skip button disappears from the DOM.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        mkPlayer({
          canSkipAhead: true,
          onSkipNext: () => {},
        }),
      );
    });
    // expanded by default: button exists
    expect(
      container.querySelector('button[aria-label="Skip ahead"]'),
    ).toBeTruthy();
    // collapse via the minimize button
    const minimize = container.querySelector(
      'button[aria-label="Minimize audio player"]',
    ) as HTMLButtonElement;
    act(() => minimize.click());
    expect(
      container.querySelector('button[aria-label="Skip ahead"]'),
    ).toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});

describe("TtsPlayer: thumbnail click", () => {
  it("only syncs to playback on same-book-on-reader without touching the sidebar", async () => {
    pathnameRef.current = `/book/test-book/reader`;
    const onSyncToPlayback = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        mkPlayer({
          bookId: "test-book",
          bookTitle: "Test Book",
          variant: "floating",
          onSyncToPlayback,
        }),
      );
    });

    const thumbnail = container.querySelector(
      'button[aria-label="Open Test Book"]',
    );
    expect(thumbnail).toBeTruthy();

    await act(async () => {
      (thumbnail as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(onSyncToPlayback).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });
});