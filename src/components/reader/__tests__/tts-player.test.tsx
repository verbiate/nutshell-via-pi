import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

// ponytail: SSR mocks — radix Select/Tooltip use portals that don't render
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
  onScrub: () => {},
  onClose: () => {},
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
      /<button[^>]*value="cloud"[^>]*>/,
    )?.[0];
    expect(cloudRadio, "cloud radio should be present").toBeTruthy();
    // ponytail: assert the boolean attribute, not the "disabled:" tailwind class.
    expect(cloudRadio!).toContain('disabled=""');
    expect(html).toContain("Upgrade to Pro");
  });

  it("does not disable Premium or show the upgrade tooltip for pro users", () => {
    const html = render(mkPlayer({ userRole: "pro" }));
    expect(html).not.toContain("Upgrade to Pro");
    const cloudRadio = html.match(/<button[^>]*value="cloud"[^>]*>/)?.[0];
    expect(cloudRadio).toBeTruthy();
    expect(cloudRadio!).not.toContain('disabled=""');
  });

  it("disables Kokoro for a language it doesn't support (de) with a tooltip", () => {
    const html = render(mkPlayer({ bookLanguage: "de" }));
    // German is in SUPERTONIC but not KOKORO → Kokoro radio disabled.
    const kokoroRadio = html.match(
      /<button[^>]*value="kokoro"[^>]*>/,
    )?.[0];
    expect(kokoroRadio).toBeTruthy();
    expect(kokoroRadio!).toContain('disabled=""');
    expect(html).toContain("Not available for de");
  });

  it("keeps Supertonic enabled for a supertonic-only language (de)", () => {
    const html = render(mkPlayer({ bookLanguage: "de" }));
    const supertonicRadio = html.match(
      /<button[^>]*value="supertonic"[^>]*>/,
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
    // cloud voices are picked server-side per tier — UI shows a single
    // "Default voice" entry instead of the no-voices placeholder.
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
    // width is set inline from loadPct.
    expect(html).toContain("width:42.7%");
  });

  it("hides the progress bar when not loading", () => {
    const html = render(mkPlayer({ state: playingState, loadPct: 42 }));
    expect(html).not.toContain("Loading voice model");
  });
});

describe("TtsPlayer: existing controls intact", () => {
  it("still renders play/pause and close buttons", () => {
    const html = render(mkPlayer());
    expect(html).toContain('aria-label="Pause"');
    expect(html).toContain('aria-label="Close audio player"');
  });

  it("hides the whole bar when IDLE", () => {
    const html = render(mkPlayer({ state: idleState }));
    expect(html).toContain("translate-y-full");
  });
});
