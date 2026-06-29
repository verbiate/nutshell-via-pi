// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  useTtsCloud,
  type UseTtsCloudOptions,
} from "../use-tts-cloud";

// ponytail: sonner toast is fired from inside the hook for the 80% soft warn
// and the 100% exhausted case. We assert call signatures, not visual output.
vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// ponytail: React 19 warns and degrades act() without this flag set.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { toast } from "sonner";

// ── fetch harness ────────────────────────────────────────────────────────────
// Each test sets responses via `setResponses`. Order = call order. The hook
// alternates usage-check → generate on every startSection. Pre-buffer fetches
// (next-section warmup) consume trailing slots too.

type FetchEntry = {
  url: string;
  status?: number;
  json?: unknown;
};

let responses: FetchEntry[] = [];

function setResponses(list: FetchEntry[]) {
  responses = [...list];
}

function consumeNext(urlMatch: string): FetchEntry | null {
  const idx = responses.findIndex((r) => r.url.includes(urlMatch));
  if (idx === -1) return null;
  return responses.splice(idx, 1)[0];
}

// ponytail: in-flight Response stub. happy-dom has its own Response but the
// tests just need .ok / .status / .json() — a minimal stub is shorter than
// wiring a real one per test.
class FakeResponse {
  status: number;
  ok: boolean;
  private body: unknown;
  constructor(entry: FetchEntry) {
    this.status = entry.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.body = entry.json;
  }
  async json(): Promise<unknown> {
    return this.body;
  }
}

// ponytail: track the "server-side" quota as the test progresses. The hook
// optimistically bumps the client snapshot after each successful generate,
// then fire-and-forgets refreshQuota which overwrites the bump. Without a
// server-side tracker, the default mock response would clobber the bump and
// break the optimistic-bump assertion. Echoing the latest explicit entry
// mirrors what a real server would have returned after incrementing.
let serverQuota: { used: number; limit: number; periodKey: string } = {
  used: 0,
  limit: 50,
  periodKey: "2026-06",
};

const fetchMock = vi.fn(async (url: string) => {
  const path = typeof url === "string" ? url : (url as any).toString?.() ?? "";
  const entry = consumeNext(path);
  if (entry) {
    // Mirror server state for usage-check defaults so subsequent fire-and-
    // forget refreshQuota calls don't clobber the optimistic bump.
    if (path.includes("/api/tts/usage-check") && entry.json) {
      const j = entry.json as any;
      if (typeof j.used === "number" && typeof j.limit === "number") {
        serverQuota = {
          used: j.used,
          limit: j.limit,
          periodKey: j.periodKey ?? serverQuota.periodKey,
        };
      }
    }
    // Mirror server-side increment on successful generate.
    if (
      path.includes("/api/tts/generate") &&
      (entry.status ?? 200) < 300
    ) {
      serverQuota = { ...serverQuota, used: serverQuota.used + 1 };
    }
    return new FakeResponse(entry);
  }
  // ponytail: fire-and-forget post-generate refresh hits the queue after the
  // awaited fetches are done. Return a benign default that mirrors the
  // server's latest known state so the client's optimistic bump isn't clobbered.
  if (path.includes("/api/tts/usage-check")) {
    return new FakeResponse({
      url: path,
      status: 200,
      json: { allowed: serverQuota.used < serverQuota.limit, ...serverQuota },
    });
  }
  throw new Error(`[test] unexpected fetch: ${path}`);
});

class FakeAbortController {
  signal = { aborted: false, reason: undefined } as any;
  abort = vi.fn(() => {
    this.signal.aborted = true;
  });
}

// ponytail: happy-dom has no HTMLAudioElement event target wiring we can lean
// on; the hook only attaches listeners, so a stub is enough.
class FakeHTMLAudioElement {
  src = "";
  currentTime = 0;
  duration = 0;
  playbackRate = 1;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};
  addEventListener = vi.fn((type: string, fn: (...args: any[]) => void) => {
    (this.listeners[type] ??= []).push(fn);
  });
  removeEventListener = vi.fn((type: string, fn: (...args: any[]) => void) => {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  });
  dispatchEvent(type: string, ...args: any[]) {
    [...(this.listeners[type] ?? [])].forEach((fn) => fn(...args));
  }
}

function installGlobals() {
  (globalThis as any).AbortController = FakeAbortController;
  (globalThis as any).HTMLAudioElement = FakeHTMLAudioElement;
  (globalThis as any).fetch = fetchMock;
}

// ── hook harness ─────────────────────────────────────────────────────────────
function Probe(
  props: UseTtsCloudOptions & {
    onApi?: (api: ReturnType<typeof useTtsCloud>) => void;
  },
) {
  const api = useTtsCloud(props);
  React.useEffect(() => {
    props.onApi?.(api);
  }, [api, props]);
  return <div data-testid="probe">{api.state.state}</div>;
}

function renderHook(props: UseTtsCloudOptions) {
  let apiRef: ReturnType<typeof useTtsCloud> | undefined;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <Probe
        {...props}
        onApi={(api) => {
          apiRef = api;
        }}
      />,
    );
  });

  return {
    getApi: () => apiRef!,
    unmount: () => act(() => root.unmount()),
  };
}

function baseProps(
  overrides: Partial<UseTtsCloudOptions> = {},
): UseTtsCloudOptions {
  return {
    bookId: "book-1",
    toc: [
      { label: "Chapter 1", href: "ch1.xhtml" },
      { label: "Chapter 2", href: "ch2.xhtml" },
    ],
    onSectionComplete: vi.fn(),
    audioRef: { current: new FakeHTMLAudioElement() } as any,
    // ponytail: primed quota on every test so we skip the mount-time fetch
    // and only declare entries for the actions each test actually performs.
    initialQuota: { used: 0, limit: 50, periodKey: "2026-06" },
    ...overrides,
  };
}

function usageCheck(allowed: boolean, used: number, limit: number): FetchEntry {
  return {
    url: "/api/tts/usage-check",
    status: 200,
    json: { allowed, used, limit, periodKey: "2026-06" },
  };
}

function generate(url: string, audioId: string): FetchEntry {
  return {
    url: "/api/tts/generate",
    status: 200,
    json: { url, audioId, cached: false },
  };
}

describe("useTtsCloud", () => {
  beforeEach(() => {
    installGlobals();
    setResponses([]);
    serverQuota = { used: 0, limit: 50, periodKey: "2026-06" };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts IDLE with no quota until refresh resolves", async () => {
    setResponses([usageCheck(true, 0, 50)]);
    const { getApi, unmount } = renderHook(
      baseProps({ initialQuota: null }),
    );

    expect(getApi().state.state).toBe("IDLE");
    expect(getApi().quota).toBeNull();
    await vi.waitFor(() =>
      expect(getApi().quota).toEqual({
        used: 0,
        limit: 50,
        periodKey: "2026-06",
      }),
    );
    unmount();
  });

  it("primes quota from initialQuota without a network call", () => {
    const { getApi, unmount } = renderHook(
      baseProps({
        initialQuota: { used: 5, limit: 50, periodKey: "2026-06" },
      }),
    );
    expect(getApi().quota).toEqual({
      used: 5,
      limit: 50,
      periodKey: "2026-06",
    });
    unmount();
  });

  it("runs pre-flight + generate on startSection and bumps local quota", async () => {
    setResponses([
      usageCheck(true, 4, 50),
      generate("https://cdn/audio.mp3", "aud-1"),
    ]);
    const { getApi, unmount } = renderHook(baseProps());

    await act(async () => {
      getApi().startSection("ch1.xhtml", "Chapter 1");
    });

    await vi.waitFor(() => expect(getApi().state.state).toBe("READY"));
    // Local optimistic bump from 4 → 5 even before the post-generate refresh.
    expect(getApi().quota?.used).toBe(5);
    expect(getApi().state.audioUrl).toBe("https://cdn/audio.mp3");
    expect(getApi().state.audioId).toBe("aud-1");
    unmount();
  });

  it("seeks cloud audio to seekRatio once metadata loads", async () => {
    setResponses([
      usageCheck(true, 0, 50),
      generate("https://cdn/audio.mp3", "aud-1"),
    ]);
    const props = baseProps();
    const { getApi, unmount } = renderHook(props);

    await act(async () => {
      getApi().startSection("ch1.xhtml", "Chapter 1", { seekRatio: 0.3 });
    });

    await vi.waitFor(() => expect(getApi().state.state).toBe("READY"));
    const audio = props.audioRef.current as unknown as FakeHTMLAudioElement;
    expect(audio.play).not.toHaveBeenCalled();
    audio.duration = 100;
    await act(async () => audio.dispatchEvent("loadedmetadata"));
    expect(audio.currentTime).toBe(30);
    expect(audio.play).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("blocks generation when pre-flight returns allowed=false (100%) and fires exhausted", async () => {
    const onQuotaExhausted = vi.fn();
    setResponses([usageCheck(false, 50, 50)]);
    const { getApi, unmount } = renderHook(
      baseProps({ onQuotaExhausted }),
    );

    await act(async () => {
      getApi().startSection("ch1.xhtml", "Chapter 1");
    });

    await vi.waitFor(() => expect(getApi().state.state).toBe("IDLE"));
    expect(onQuotaExhausted).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Monthly Premium TTS limit reached"),
    );
    unmount();
  });

  it("short-circuits without a network call when quota already exhausted", async () => {
    const onQuotaExhausted = vi.fn();
    setResponses([]); // nothing queued — assert no fetch happens
    const { getApi, unmount } = renderHook(
      baseProps({
        initialQuota: { used: 50, limit: 50, periodKey: "2026-06" },
        onQuotaExhausted,
      }),
    );

    await act(async () => {
      getApi().startSection("ch1.xhtml", "Chapter 1");
    });
    expect(onQuotaExhausted).toHaveBeenCalledTimes(1);

    expect(getApi().state.state).toBe("IDLE");
    unmount();
  });

  it("handles 429 from the generate route as exhausted (race protection)", async () => {
    const onQuotaExhausted = vi.fn();
    setResponses([
      usageCheck(true, 49, 50),
      { url: "/api/tts/generate", status: 429, json: { used: 50, limit: 50 } },
    ]);
    const { getApi, unmount } = renderHook(
      baseProps({ onQuotaExhausted }),
    );

    await act(async () => {
      getApi().startSection("ch1.xhtml", "Chapter 1");
    });

    await vi.waitFor(() => expect(onQuotaExhausted).toHaveBeenCalledTimes(1));
    expect(getApi().state.state).toBe("IDLE");
    expect(getApi().quota?.used).toBe(50);
    unmount();
  });

  it("fires the 80% soft warning exactly once per period", async () => {
    setResponses([
      // first startSection: pre-flight 37/50 (74%); optimistic bump → 38 (76%, no warn)
      usageCheck(true, 37, 50),
      generate("https://cdn/a.mp3", "a1"),
      // second startSection: pre-flight 39/50; bump → 40 (80%, warn fires)
      usageCheck(true, 39, 50),
      generate("https://cdn/b.mp3", "a2"),
      // third startSection: pre-flight 40/50; bump → 41 (82%, no re-warn — latched)
      usageCheck(true, 40, 50),
      generate("https://cdn/c.mp3", "a3"),
    ]);
    const { getApi, unmount } = renderHook(baseProps());

    await act(async () => getApi().startSection("ch1.xhtml", "Chapter 1"));
    await vi.waitFor(() => expect(getApi().state.state).toBe("READY"));
    expect(toast.warning).not.toHaveBeenCalled();

    await act(async () => getApi().startSection("ch1.xhtml", "Chapter 1"));
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));

    await act(async () => getApi().startSection("ch1.xhtml", "Chapter 1"));
    await vi.waitFor(() => expect(getApi().state.state).toBe("READY"));
    expect(toast.warning).toHaveBeenCalledTimes(1); // still 1

    unmount();
  });

  it("resets the 100% exhaustion latch when periodKey rolls over", async () => {
    const onQuotaExhausted = vi.fn();
    // June: at limit. Short-circuit path fires exhausted.
    setResponses([]);
    const { getApi, unmount } = renderHook(
      baseProps({
        initialQuota: { used: 50, limit: 50, periodKey: "2026-06" },
        onQuotaExhausted,
      }),
    );

    await act(async () => {
      getApi().startSection("ch1.xhtml", "Chapter 1");
    });
    expect(onQuotaExhausted).toHaveBeenCalledTimes(1);

    // July rollover via refreshQuota — server reports a fresh quota.
    setResponses([
      {
        url: "/api/tts/usage-check",
        status: 200,
        json: { allowed: true, used: 0, limit: 50, periodKey: "2026-07" },
      },
    ]);
    await act(async () => {
      await getApi().refreshQuota();
    });
    expect(getApi().quota?.periodKey).toBe("2026-07");

    // Hit the limit again in July via the pre-flight path.
    setResponses([
      {
        url: "/api/tts/usage-check",
        status: 200,
        json: { allowed: false, used: 50, limit: 50, periodKey: "2026-07" },
      },
    ]);
    await act(async () => {
      getApi().startSection("ch1.xhtml", "Chapter 1");
    });
    // Latch reset across periods → exhaustion fires AGAIN in the new month.
    await vi.waitFor(() => expect(onQuotaExhausted).toHaveBeenCalledTimes(2));
    unmount();
  });

  it("does not divide-by-zero when limit is 0 (regular tier snapshot)", async () => {
    setResponses([usageCheck(false, 0, 0)]);
    const { getApi, unmount } = renderHook(
      baseProps({
        initialQuota: { used: 0, limit: 0, periodKey: "2026-06" },
      }),
    );

    await act(async () => {
      getApi().startSection("ch1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.state).toBe("IDLE"));
    expect(toast.warning).not.toHaveBeenCalled();
    unmount();
  });

  it("surfaces a generic error toast on non-429 generate failure", async () => {
    setResponses([
      usageCheck(true, 1, 50),
      {
        url: "/api/tts/generate",
        status: 500,
        json: { error: "Internal server error" },
      },
    ]);
    const { getApi, unmount } = renderHook(baseProps());

    await act(async () => getApi().startSection("ch1.xhtml", "Chapter 1"));
    await vi.waitFor(() => expect(getApi().state.state).toBe("IDLE"));
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Premium audio generation failed"),
    );
    unmount();
  });

  // ponytail: handleEnded must fire onSectionComplete unconditionally (both
  // with and without a next flat-toc section) so AudioProvider's
  // handleSectionComplete can clear the session at end-of-book. Previously the
  // no-next branch set state IDLE without firing onSectionComplete, leaving a
  // sticky IDLE+session gap where the play button did nothing.
  it("fires onSectionComplete and goes ENDED when a next section exists", async () => {
    setResponses([
      usageCheck(true, 0, 50),
      generate("https://cdn/audio.mp3", "aud-1"),
    ]);
    const onSectionComplete = vi.fn();
    const props = baseProps({ onSectionComplete });
    const { getApi, unmount } = renderHook(props);

    await act(async () => {
      getApi().startSection("ch1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.state).toBe("READY"));

    await act(async () => {
      (props.audioRef.current as unknown as FakeHTMLAudioElement).dispatchEvent("ended");
    });

    expect(onSectionComplete).toHaveBeenCalledTimes(1);
    expect(getApi().state.state).toBe("ENDED");
    unmount();
  });

  it("fires onSectionComplete and goes IDLE at end of flat-toc (no next section)", async () => {
    setResponses([
      usageCheck(true, 0, 50),
      generate("https://cdn/audio.mp3", "aud-1"),
    ]);
    const onSectionComplete = vi.fn();
    const props = baseProps({ onSectionComplete });
    const { getApi, unmount } = renderHook(props);

    // Last chapter in the 2-chapter toc → no next flat-toc section.
    await act(async () => {
      getApi().startSection("ch2.xhtml", "Chapter 2");
    });
    await vi.waitFor(() => expect(getApi().state.state).toBe("READY"));

    await act(async () => {
      (props.audioRef.current as unknown as FakeHTMLAudioElement).dispatchEvent("ended");
    });

    expect(onSectionComplete).toHaveBeenCalledTimes(1);
    expect(getApi().state.state).toBe("IDLE");
    unmount();
  });

  it("refreshQuota updates quota without touching playback state", async () => {
    setResponses([usageCheck(true, 7, 50)]);
    const { getApi, unmount } = renderHook(
      baseProps({ initialQuota: null }),
    );

    await vi.waitFor(() => expect(getApi().quota?.used).toBe(7));
    expect(getApi().state.state).toBe("IDLE");

    setResponses([usageCheck(true, 9, 50)]);
    await act(async () => {
      await getApi().refreshQuota();
    });
    expect(getApi().quota?.used).toBe(9);
    expect(getApi().state.state).toBe("IDLE");
    unmount();
  });
});
