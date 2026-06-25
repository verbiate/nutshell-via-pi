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

// ponytail: TtsPlayer calls useRouter/usePathname at render; bare SSR has no
// App Router context, so stub them. pathnameRef lets interaction tests set the
// current route.
const pathnameRef = vi.hoisted(() => ({ current: null as string | null }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ push: vi.fn() }),
}));

import { TtsPlayer } from "../tts-player";
import type { TtsPlaybackState } from "@/hooks/use-tts-playback";
import type { EngineId } from "@/lib/tts/languages";
import type { UserRole } from "@/types/book";

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
  onEngineChange: (_: EngineId) => {},
  onVoiceChange: (_: string) => {},
};

function mkPlayer(overrides: Partial<Parameters<typeof TtsPlayer>[0]> = {}) {
  return (
    <TtsPlayer
      state={playingState}
      bookLanguage="en"
      enginePref="kokoro"
      voicePref="af_bella"
      userRole={"regular" as UserRole}
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

describe("TtsPlayer: engine switcher", () => {
  it("renders all three engine options with the spec labels", () => {
    const html = render(mkPlayer());
    expect(html).toContain("Free (Highest Quality)");
    expect(html).toContain("Free (Faster)");
    expect(html).toContain("Premium");
  });

  it("emits engine ids as radio values", () => {
    const html = render(mkPlayer());
    expect(html).toContain('value="kokoro"');
    expect(html).toContain('value="supertonic"');
    expect(html).toContain('value="cloud"');
  });

  it('disables "Premium" for regular users and shows the upgrade tooltip', () => {
    const html = render(mkPlayer({ userRole: "regular" }));
    const cloudRadio = html.match(
      /<button[^\u003e]*value="cloud"[^\u003e]*>/,
    )?.[0];
    expect(cloudRadio, "cloud radio should be present").toBeTruthy();
    expect(cloudRadio!).toContain('disabled=""');
    expect(html).toContain("Upgrade to Pro");
  });

  it("does not disable Premium or show the upgrade tooltip for pro users", () => {
    const html = render(mkPlayer({ userRole: "pro" }));
    expect(html).not.toContain("Upgrade to Pro");
    const cloudRadio = html.match(/<button[^\u003e]*value="cloud"[^\u003e]*>/)?.[0];
    expect(cloudRadio).toBeTruthy();
    expect(cloudRadio!).not.toContain('disabled=""');
  });

  it("disables Kokoro for a language it doesn't support (de) with a tooltip", () => {
    const html = render(mkPlayer({ bookLanguage: "de" }));
    const kokoroRadio = html.match(
      /<button[^\u003e]*value="kokoro"[^\u003e]*>/,
    )?.[0];
    expect(kokoroRadio).toBeTruthy();
    expect(kokoroRadio!).toContain('disabled=""');
    expect(html).toContain("Not available for de");
  });

  it("keeps Supertonic enabled for a supertonic-only language (de)", () => {
    const html = render(mkPlayer({ bookLanguage: "de" }));
    const supertonicRadio = html.match(
      /<button[^\u003e]*value="supertonic"[^\u003e]*>/,
    )?.[0];
    expect(supertonicRadio).toBeTruthy();
    expect(supertonicRadio!).not.toContain('disabled=""');
  });
});

describe("TtsPlayer: voice picker", () => {
  it("renders the voice select trigger", () => {
    const html = render(mkPlayer());
    expect(html).toContain('data-trigger');
    expect(html).toContain('aria-label="Voice"');
  });

  it("renders Kokoro English voices with region tags", () => {
    const html = render(
      mkPlayer({ enginePref: "kokoro", bookLanguage: "en" }),
    );
    expect(html).toContain("Bella (US)");
    expect(html).toContain("Daniel (GB)");
  });

  it("renders Supertonic voices without region tags", () => {
    const html = render(
      mkPlayer({ enginePref: "supertonic", bookLanguage: "en" }),
    );
    expect(html).toContain("Male 1");
    expect(html).toContain("Female 1");
    expect(html).not.toContain("Male 1 (");
  });

  it("renders the Default voice placeholder for the cloud engine", () => {
    const html = render(
      mkPlayer({ enginePref: "cloud", userRole: "pro" }),
    );
    expect(html).toContain("Default voice");
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

describe("TtsPlayer: playlist", () => {
  it("shows a playlist button when playlist + onJumpTo are provided", () => {
    const html = render(
      mkPlayer({
        playlist: [
          { label: "Chapter 1", href: "ch1.xhtml", index: 0 },
          { label: "Chapter 2", href: "ch2.xhtml", index: 1 },
        ],
        onJumpTo: () => {},
      }),
    );
    expect(html).toContain('aria-label="Playlist"');
  });

  it("hides the playlist button when no onJumpTo is provided", () => {
    const html = render(mkPlayer());
    expect(html).not.toContain('aria-label="Playlist"');
  });

  it("renders the playlist dialog with the current section highlighted", () => {
    const html = render(
      mkPlayer({
        playlist: [
          { label: "Chapter 1", href: "ch1.xhtml", index: 0 },
          { label: "Chapter 2", href: "ch2.xhtml", index: 1 },
        ],
        currentIndex: 1,
        onJumpTo: () => {},
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
});

describe("TtsPlayer: thumbnail click", () => {
  it("awaits onSyncToPlayback before opening details on same-book-on-reader", async () => {
    pathnameRef.current = `/book/test-book/reader`;
    const order: string[] = [];
    const onSyncToPlayback = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("sync");
    });
    const onOpenBookDetails = vi.fn(() => order.push("details"));

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
          onOpenBookDetails,
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
    expect(onOpenBookDetails).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["sync", "details"]);

    act(() => root.unmount());
    container.remove();
  });
});
