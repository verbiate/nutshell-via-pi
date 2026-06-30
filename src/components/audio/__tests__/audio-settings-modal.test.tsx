// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

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

import { AudioSettingsModal } from "../audio-provider";
import type { EngineId } from "@/lib/tts/languages";
import type { UserRole } from "@/types/book";
import type { CloudQuota } from "@/hooks/use-tts-cloud";

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

const noop = () => {};
const baseProps = {
  open: true,
  onOpenChange: noop,
  bookLanguage: "en",
  enginePref: "kokoro" as EngineId,
  effectiveEngineId: "kokoro" as EngineId,
  onEngineChange: noop,
  voicePref: "af_bella",
  onVoiceChange: noop,
  voiceSpeed: 1,
  onVoiceSpeedChange: noop,
  userRole: "regular" as UserRole,
  quota: null as CloudQuota | null,
};

function mkModal(overrides: Partial<Parameters<typeof AudioSettingsModal>[0]> = {}) {
  return <AudioSettingsModal {...baseProps} {...overrides} />;
}

describe("AudioSettingsModal: title", () => {
  it("renders 'Audio settings' as the modal title", () => {
    const html = render(mkModal());
    expect(html).toContain("Audio settings");
  });
});

describe("AudioSettingsModal: engine switcher", () => {
  it("renders all three engine options with the spec labels", () => {
    const html = render(mkModal());
    expect(html).toContain("Free (Highest Quality)");
    expect(html).toContain("Free (Faster)");
    expect(html).toContain("Premium");
  });

  it("emits engine ids as radio values", () => {
    const html = render(mkModal());
    expect(html).toContain('value="kokoro"');
    expect(html).toContain('value="supertonic"');
    expect(html).toContain('value="cloud"');
  });

  it('disables "Premium" for regular users and shows the upgrade tooltip', () => {
    const html = render(mkModal({ userRole: "regular" }));
    const cloudRadio = html.match(/<button[^>]*value="cloud"[^>]*>/)?.[0];
    expect(cloudRadio, "cloud radio should be present").toBeTruthy();
    expect(cloudRadio!).toContain('disabled=""');
    expect(html).toContain("Upgrade to Pro");
  });

  it("does not disable Premium or show the upgrade tooltip for pro users", () => {
    const html = render(mkModal({ userRole: "pro" }));
    expect(html).not.toContain("Upgrade to Pro");
    const cloudRadio = html.match(/<button[^>]*value="cloud"[^>]*>/)?.[0];
    expect(cloudRadio).toBeTruthy();
    expect(cloudRadio!).not.toContain('disabled=""');
  });

  it("disables Kokoro for a language it doesn't support (de) with a tooltip", () => {
    const html = render(mkModal({ bookLanguage: "de" }));
    const kokoroRadio = html.match(/<button[^>]*value="kokoro"[^>]*>/)?.[0];
    expect(kokoroRadio).toBeTruthy();
    expect(kokoroRadio!).toContain('disabled=""');
    expect(html).toContain("Not available for de");
  });

  it("keeps Supertonic enabled for a supertonic-only language (de)", () => {
    const html = render(mkModal({ bookLanguage: "de" }));
    const supertonicRadio = html.match(
      /<button[^>]*value="supertonic"[^>]*>/,
    )?.[0];
    expect(supertonicRadio).toBeTruthy();
    expect(supertonicRadio!).not.toContain('disabled=""');
  });

  it("shows the cloud quota badge when engine is cloud and quota is set", () => {
    const quota: CloudQuota = { used: 3, limit: 50, periodKey: "2026-06" };
    const html = render(mkModal({ enginePref: "cloud", userRole: "pro", quota }));
    expect(html).toContain("3 / 50 generations this month");
  });

  it("shows the upgrade CTA when cloud quota limit is 0 (no cloud access)", () => {
    const quota: CloudQuota = { used: 0, limit: 0, periodKey: "2026-06" };
    const html = render(mkModal({ enginePref: "cloud", userRole: "pro", quota }));
    expect(html).toContain("Premium: upgrade to Pro");
  });

  it("disables Premium and shows 'Monthly limit reached' when quota is exhausted", () => {
    const quota: CloudQuota = { used: 50, limit: 50, periodKey: "2026-06" };
    const html = render(mkModal({ enginePref: "cloud", userRole: "pro", quota }));
    const cloudRadio = html.match(/<button[^>]*value="cloud"[^>]*>/)?.[0];
    expect(cloudRadio).toBeTruthy();
    expect(cloudRadio!).toContain('disabled=""');
    expect(html).toContain("Monthly limit reached");
  });
});

describe("AudioSettingsModal: voice picker", () => {
  it("renders the voice select trigger", () => {
    const html = render(mkModal());
    expect(html).toContain("data-trigger");
    expect(html).toContain('aria-label="Voice"');
  });

  it("renders Kokoro English voices with region tags", () => {
    const html = render(mkModal({ enginePref: "kokoro" }));
    expect(html).toContain("Bella (US)");
    expect(html).toContain("Daniel (GB)");
  });

  it("renders Supertonic voices without region tags", () => {
    const html = render(
      mkModal({ enginePref: "supertonic", effectiveEngineId: "supertonic" }),
    );
    expect(html).toContain("Male 1");
    expect(html).toContain("Female 1");
    expect(html).not.toContain("Male 1 (");
  });

  it("renders the Default voice placeholder for the cloud engine", () => {
    const html = render(mkModal({ enginePref: "cloud", userRole: "pro" }));
    expect(html).toContain("Default voice");
  });
});

describe("AudioSettingsModal: reading speed slider", () => {
  it("renders the slider with a 'Reading speed' aria-label", () => {
    const html = render(mkModal());
    expect(html).toContain('aria-label="Reading speed"');
  });

  it("shows the speed scale labels under the slider", () => {
    const html = render(mkModal());
    expect(html).toContain("0.5×");
    expect(html).toContain("1.25×");
    expect(html).toContain("1.5×");
    expect(html).toContain("2×");
    expect(html).toContain("REGULAR");
  });
});