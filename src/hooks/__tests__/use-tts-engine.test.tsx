// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { useTtsEngine, _resetKokoroKnownBroken, findStartChunkIndex, type UseTtsEngineOptions } from "../use-tts-engine";

vi.mock("@/lib/tts/engines", () => ({
  getEngine: vi.fn(),
}));

vi.mock("@/lib/tts/chunk", () => ({
  chunkText: vi.fn(),
  CHUNK_LIMITS: {
    kokoro: { softLimit: 400, hardLimit: 500 },
    supertonic: { softLimit: 400, hardLimit: 500 },
    cloud: { softLimit: 4500, hardLimit: 5000 },
    browser: { softLimit: 400, hardLimit: 500 },
  },
}));

// ponytail: sonner toast fires from the fallback branch in resolveEngine.
vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

import { getEngine } from "@/lib/tts/engines";
import { chunkText } from "@/lib/tts/chunk";
import { _resetWpmCache } from "@/lib/tts/estimate";
import { toast } from "sonner";

class FakeAudioBuffer implements AudioBuffer {
  duration = 0.1;
  sampleRate = 44100;
  length = 4410;
  numberOfChannels = 1;
  getChannelData = vi.fn(() => new Float32Array());
  copyFromChannel = vi.fn();
  copyToChannel = vi.fn();
}

class FakeAudioBufferSourceNode {
  buffer: AudioBuffer | null = null;
  onended: ((this: AudioScheduledSourceNode, ev: Event) => any) | null = null;
  private _started = false;

  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  dispatchEvent = vi.fn(() => true);

  connect() {
    return {} as unknown as AudioNode;
  }
  disconnect() {}
  start() {
    this._started = true;
  }
  stop() {
    if (this._started && this.onended) {
      (this.onended as any).call(this, new Event("ended"));
    }
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = "running";
  destination = {} as unknown as AudioDestinationNode;
  currentTime = 0;
  sampleRate = 44100;
  baseLatency = 0;
  onstatechange = null;
  lastSource: FakeAudioBufferSourceNode | null = null;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeAudioBufferSourceNode();
    this.lastSource = source;
    return source as unknown as AudioBufferSourceNode;
  }

  suspend(): Promise<void> {
    this.state = "suspended";
    return Promise.resolve();
  }

  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }

  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  dispatchEvent = vi.fn(() => true);
  createAnalyser = vi.fn(() => ({} as unknown as AnalyserNode));
  createBiquadFilter = vi.fn(() => ({} as unknown as BiquadFilterNode));
  createBuffer = vi.fn(() => new FakeAudioBuffer() as unknown as AudioBuffer);
  createChannelMerger = vi.fn(() => ({} as unknown as ChannelMergerNode));
  createChannelSplitter = vi.fn(() => ({} as unknown as ChannelSplitterNode));
  createConstantSource = vi.fn(() => ({} as unknown as ConstantSourceNode));
  createConvolver = vi.fn(() => ({} as unknown as ConvolverNode));
  createDelay = vi.fn(() => ({} as unknown as DelayNode));
  createDynamicsCompressor = vi.fn(
    () => ({} as unknown as DynamicsCompressorNode),
  );
  createGain = vi.fn(() => ({} as unknown as GainNode));
  createIIRFilter = vi.fn(() => ({} as unknown as IIRFilterNode));
  createOscillator = vi.fn(() => ({} as unknown as OscillatorNode));
  createPanner = vi.fn(() => ({} as unknown as PannerNode));
  createPeriodicWave = vi.fn(() => ({} as unknown as PeriodicWave));
  createScriptProcessor = vi.fn(() => ({} as unknown as ScriptProcessorNode));
  createStereoPanner = vi.fn(() => ({} as unknown as StereoPannerNode));
  createWaveShaper = vi.fn(() => ({} as unknown as WaveShaperNode));
  decodeAudioData = vi.fn(() =>
    Promise.resolve(new FakeAudioBuffer() as unknown as AudioBuffer),
  );
  getOutputTimestamp = vi.fn(() => ({ contextTime: 0, performanceTime: 0 }));
  listener = {} as unknown as AudioListener;
}

function createMockEngine() {
  return {
    id: "kokoro",
    label: "Kokoro",
    getVoices: vi.fn(() => []),
    supportsLanguage: vi.fn(() => true),
    ensureLoaded: vi.fn(async (onProgress?: (pct: number) => void) => {
      onProgress?.(0.5);
      onProgress?.(1);
    }),
    synthesize: vi.fn(async () => ({
      kind: "audioBuffer" as const,
      buffer: new FakeAudioBuffer() as unknown as AudioBuffer,
    })),
  };
}

function createGetText(text: string) {
  return vi.fn(async () => text);
}

// ponytail: a mock EpubViewerHandle that records setTtsPaused calls so the
// pause/resume/close fade behavior can be asserted without a real iframe.
function createMockViewerRef() {
  const viewer = {
    highlightChunk: vi.fn(async () => {}),
    clearTtsHighlight: vi.fn(),
    setTtsPaused: vi.fn(),
  };
  return { current: viewer } as unknown as Parameters<
    typeof useTtsEngine
  >[0]["viewerRef"];
}

function Probe(
  props: UseTtsEngineOptions & {
    onApi?: (api: ReturnType<typeof useTtsEngine>) => void;
  },
) {
  const api = useTtsEngine(props);
  React.useEffect(() => {
    props.onApi?.(api);
  }, [api, props]);
  return <div data-testid="probe">{api.state.phase}</div>;
}

function renderHook(props: UseTtsEngineOptions) {
  let apiRef: ReturnType<typeof useTtsEngine> | undefined;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const renderProbe = (p: UseTtsEngineOptions) =>
    act(() => {
      root.render(
        <Probe
          {...p}
          onApi={(api) => {
            apiRef = api;
          }}
        />,
      );
    });

  renderProbe(props);

  return {
    getApi: () => apiRef!,
    unmount: () => act(() => root.unmount()),
    rerender: renderProbe,
  };
}

describe("findStartChunkIndex", () => {
  // ponytail: locks in contain-snap semantics WITH separator-aware coords.
  // chunkText drops the 1-char separator between chunks, so chunk i's source
  // start = sum(len[0..i-1]) + i. For ["AAAA","BBBB","CCCC"] that's source
  // spans [0,4), [5,9), [10,14) — NOT contiguous. Feeding a source offset and
  // ignoring the +i drift was the right-click "Play now" off-by-one.
  const chunks = ["AAAA", "BBBB", "CCCC"]; // source spans [0,4), [5,9), [10,14)

  it("returns the chunk containing the offset, not the next one", () => {
    expect(findStartChunkIndex(chunks, 3)).toBe(0); // inside AAAA
    expect(findStartChunkIndex(chunks, 7)).toBe(1); // inside BBBB
    expect(findStartChunkIndex(chunks, 12)).toBe(2); // inside CCCC
  });

  it("returns the chunk starting exactly at the offset", () => {
    expect(findStartChunkIndex(chunks, 0)).toBe(0); // start of AAAA
    expect(findStartChunkIndex(chunks, 5)).toBe(1); // start of BBBB
    expect(findStartChunkIndex(chunks, 10)).toBe(2); // start of CCCC
  });

  it("does not drift forward deep in a chunk list (the Play-now regression)", () => {
    // 25 four-char chunks: chunk 24's source start = 24*4 + 24 = 120. An offset
    // in the latter part of chunk 24 (e.g. 122) must resolve to 24, not clamp
    // past it. The buggy contiguous version would push such offsets forward.
    const many = Array.from({ length: 25 }, () => "AAAA");
    expect(findStartChunkIndex(many, 122)).toBe(24);
  });

  it("clamps to the last chunk when the offset is out of range", () => {
    expect(findStartChunkIndex(chunks, 99)).toBe(2);
    expect(findStartChunkIndex(["AAAA", "BBBB"], 999)).toBe(1);
  });

  it("returns 0 for non-positive offsets", () => {
    expect(findStartChunkIndex(chunks, 0)).toBe(0);
    expect(findStartChunkIndex(chunks, -5)).toBe(0);
  });
});

describe("findStartChunkIndex vs real chunkText (Play-now regression)", () => {
  // Reproduces the right-click "Play now" off-by-one: chunkText drops the 1-char
  // separator BETWEEN chunks while htmlToTtsText emits it, so naive cumulative
  // chunk lengths drift forward ~1 char per boundary. Deep in a section, clicks
  // in the latter part of chunk N resolved to N+1. This test feeds REAL chunkText
  // output + the source offset of each chunk's final char and expects chunk N.
  it("resolves a chunk's final source char to that chunk, not the next", async () => {
    const { chunkText: realChunkText } = await vi.importActual<
      typeof import("@/lib/tts/chunk")
    >("@/lib/tts/chunk");

    const sentences = Array.from({ length: 60 }, (_, i) =>
      `Sentence number ${String(i).padStart(2, "0")} is here.`,
    );
    const text = sentences.join(" "); // single paragraph → 1-char " " between all
    const chunks = realChunkText(text, { softLimit: 40, hardLimit: 60 });
    expect(chunks.length).toBeGreaterThan(10);

    // Oracle: with single-space separators every chunk is an exact substring of
    // the source, so its source span is just text.indexOf(chunk).
    let searchFrom = 0;
    for (let i = 0; i < chunks.length; i++) {
      const start = text.indexOf(chunks[i], searchFrom);
      const end = start + chunks[i].length;
      searchFrom = end;
      // The final source char of chunk i sits in the "drift zone" where the old
      // contiguous logic pushed to i+1. It must resolve to i.
      const got = findStartChunkIndex(chunks, end - 1);
      if (got !== i) {
        throw new Error(
          `chunk ${i}: source offset ${end - 1} resolved to ${got}, expected ${i}`,
        );
      }
    }
  });
});

describe("useTtsEngine", () => {
  let mockEngine: ReturnType<typeof createMockEngine>;

  beforeEach(() => {
    _resetKokoroKnownBroken();
    mockEngine = createMockEngine();
    vi.mocked(getEngine).mockResolvedValue(mockEngine as any);
    vi.mocked(chunkText).mockReturnValue(["chunk one", "chunk two"]);
    FakeAudioContext.instances = [];
    // ponytail: the per-voice WPM cache (session map + storage) leaks across
    // tests; reset it so duration-seed behavior is deterministic.
    _resetWpmCache();
    Object.defineProperty(globalThis, "AudioContext", {
      writable: true,
      configurable: true,
      value: FakeAudioContext,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in the IDLE phase", () => {
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });
    expect(getApi().state.phase).toBe("IDLE");
    // Without a fallback, effectiveEngineId mirrors the requested engine.
    expect(getApi().effectiveEngineId).toBe("kokoro");
    unmount();
  });

  it("reads section text, loads the engine, chunks text, and plays the first chunk", async () => {
    const getText = createGetText("Hello world. This is a test.");
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText,
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    // ponytail: startSection reads text through the injected source; the
    // source decides whether to use the live iframe or the server endpoint.
    expect(getText).toHaveBeenCalledWith("xhtml/chapter1.xhtml", undefined);
    expect(mockEngine.ensureLoaded).toHaveBeenCalled();
    expect(chunkText).toHaveBeenCalledWith(
      "Hello world. This is a test.",
      expect.objectContaining({ softLimit: 400, hardLimit: 500 }),
    );
    expect(mockEngine.synthesize).toHaveBeenCalledWith("chunk one", {
      voiceId: "af_bella",
      lang: "en",
      speed: 1,
    });
    expect(getApi().state.sectionTitle).toBe("Chapter 1");

    unmount();
  });

  it("advances to the next chunk when the current one ends", async () => {
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world. This is a test."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    // ponytail: with prefetch, chunk two is synthesized in the background as
    // soon as chunk one starts playing.
    await vi.waitFor(() =>
      expect(mockEngine.synthesize).toHaveBeenCalledTimes(2),
    );
    expect(mockEngine.synthesize).toHaveBeenLastCalledWith("chunk two", {
      voiceId: "af_bella",
      lang: "en",
      speed: 1,
    });

    act(() => {
      const ctx = FakeAudioContext.instances[0];
      const source = ctx?.lastSource;
      expect(source).toBeTruthy();
      (source as any).onended?.(new Event("ended"));
    });

    // ponytail: chunk two was already prefetched, so advancing does not start
    // a new synthesis call.
    await vi.waitFor(() =>
      expect(mockEngine.synthesize).toHaveBeenCalledTimes(2),
    );

    unmount();
  });

  it("highlights each chunk in the viewer and clears the prior mark", async () => {
    const viewerRef = createMockViewerRef();
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world. This is a test."),
      engineId: "kokoro",
      voiceId: "af_bella",
      viewerRef,
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    expect(viewerRef!.current?.clearTtsHighlight).toHaveBeenCalled();
    // ponytail: highlightChunk always carries an opts arg. The FIRST chunk of a
    // section stamps { skipBlockJump, force: true } — force resets
    // userBrowsedAway so the page-turn re-engages at section start (verse-level
    // playlists need it for verse→verse auto-advance). Recursive forward chunks
    // pass no opts, so their calls carry { skipBlockJump: undefined } only.
    expect(viewerRef!.current?.highlightChunk).toHaveBeenCalledWith("chunk one", { skipBlockJump: undefined, force: true });

    act(() => {
      const ctx = FakeAudioContext.instances[0];
      const source = ctx?.lastSource;
      expect(source).toBeTruthy();
      (source as any).onended?.(new Event("ended"));
    });

    await vi.waitFor(() =>
      expect(viewerRef!.current?.highlightChunk).toHaveBeenCalledTimes(2),
    );
    expect(viewerRef!.current?.highlightChunk).toHaveBeenLastCalledWith(
      "chunk two",
      { skipBlockJump: undefined },
    );

    unmount();
  });

  it("highlights on a newly registered viewer after playback started off-reader", async () => {
    const { getApi, rerender, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world. This is a test."),
      engineId: "kokoro",
      voiceId: "af_bella",
      // ponytail: audio starts while no viewer is registered (bookshelf or
      // another book). The running playChunk chain must still pick up the
      // viewer when we later return to this book's reader.
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    const viewerRef = createMockViewerRef();
    rerender({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world. This is a test."),
      engineId: "kokoro",
      voiceId: "af_bella",
      viewerRef,
    });

    act(() => {
      const ctx = FakeAudioContext.instances[0];
      const source = ctx?.lastSource;
      expect(source).toBeTruthy();
      (source as any).onended?.(new Event("ended"));
    });

    await vi.waitFor(() =>
      expect(viewerRef!.current?.highlightChunk).toHaveBeenLastCalledWith(
        "chunk two",
        { skipBlockJump: undefined },
      ),
    );

    unmount();
  });

  it("resolves startPos through a viewer registered after startSection was memoized", async () => {
    const getText = createGetText("Hello world. This is a test.");
    const baseProps = {
      bookId: "book-1",
      bookLanguage: "en",
      getText,
      engineId: "kokoro" as const,
      voiceId: "af_bella",
    };

    const { getApi, rerender, unmount } = renderHook(baseProps);

    // ponytail: startSection is memoized before any viewer is registered.
    // If it captures the stale viewerRef prop, the selection offset is skipped
    // and playback falls back to chunk 0 (regression for "Start reading from here").
    const getTtsStartOffset = vi.fn(() => 15);
    const viewerRef = {
      current: {
        highlightChunk: vi.fn(async () => {}),
        clearTtsHighlight: vi.fn(),
        setTtsPaused: vi.fn(),
        getTtsStartOffset,
      },
    } as unknown as Parameters<typeof useTtsEngine>[0]["viewerRef"];

    rerender({ ...baseProps, viewerRef });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1", {
        startCfi: "epubcfi(/6/2!/4/1:8)",
      });
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    expect(getTtsStartOffset).toHaveBeenCalledWith({
      startCfi: "epubcfi(/6/2!/4/1:8)",
    });
    // ponytail: offset 15 lands in the second chunk ("chunk two"), proving
    // startPos was resolved through the newly registered viewer ref.
    expect(mockEngine.synthesize).toHaveBeenNthCalledWith(1, "chunk two", {
      voiceId: "af_bella",
      lang: "en",
      speed: 1,
    });

    unmount();
  });

  it("propagates skipBlockJump=true to highlightChunk for the first chunk when useVisible is set, and clears it for subsequent chunks", async () => {
    // ponytail: pins the "Start reading from here" no-flash contract. The first
    // chunk's highlightChunk call carries { skipBlockJump: true } so the viewer
    // skips display(blockCfi) when the straddling chunk's start block is on a
    // previous column. Recursive chunks (forward playback) get no opts →
    // display(blockCfi) runs normally.
    const getText = createGetText("Hello world. This is a test.");
    const highlightChunk = vi.fn(async () => {});
    const viewerRef = {
      current: {
        highlightChunk,
        clearTtsHighlight: vi.fn(),
        setTtsPaused: vi.fn(),
        getTtsStartOffset: vi.fn(() => 5),
      },
    } as unknown as Parameters<typeof useTtsEngine>[0]["viewerRef"];

    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText,
      engineId: "kokoro",
      voiceId: "af_bella",
      viewerRef,
    } as Parameters<typeof useTtsEngine>[0]);

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1", {
        useVisible: true,
      });
    });
    await vi.waitFor(() => expect(highlightChunk).toHaveBeenCalled());

    // ponytail: with the mocked chunkText (["chunk one","chunk two"]) and
    // getTtsStartOffset returning 5, findStartChunkIndex returns 0 (offset 5
    // is inside "chunk one"). The first highlightChunk call must carry the
    // skipBlockJump flag so the viewer stays put instead of flashing backward
    // to a straddling block's off-page start, plus force:true to re-engage
    // follow-along at this section start.
    expect(highlightChunk).toHaveBeenNthCalledWith(
      1,
      "chunk one",
      { skipBlockJump: true, force: true },
    );

    unmount();
  });

  it("prefetches the next chunk while the current chunk plays", async () => {
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world. This is a test."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    // ponytail: chunk one was synthesized to start playback; chunk two was
    // prefetched in the background immediately after source.start().
    await vi.waitFor(() =>
      expect(mockEngine.synthesize).toHaveBeenCalledTimes(2),
    );
    expect(mockEngine.synthesize).toHaveBeenNthCalledWith(1, "chunk one", {
      voiceId: "af_bella",
      lang: "en",
      speed: 1,
    });
    expect(mockEngine.synthesize).toHaveBeenNthCalledWith(2, "chunk two", {
      voiceId: "af_bella",
      lang: "en",
      speed: 1,
    });

    act(() => {
      const ctx = FakeAudioContext.instances[0];
      const source = ctx?.lastSource;
      expect(source).toBeTruthy();
      (source as any).onended?.(new Event("ended"));
    });

    // ponytail: advancing to chunk two should not trigger a third synthesis;
    // it plays from the prefetched cache.
    await vi.waitFor(() =>
      expect(mockEngine.synthesize).toHaveBeenCalledTimes(2),
    );
    expect(getApi().state.phase).toBe("PLAYING");

    unmount();
  });

  it("exposes section duration and zeroed currentTime before playback ticks", async () => {
    // ponytail: FakeAudioBuffer.duration = 0.1; two chunks → duration converges
    // to 0.2 as the buffers resolve. currentTime starts at the chunk boundary.
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world. This is a test."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    expect(getApi().state.currentTime).toBe(0);
    await vi.waitFor(() => expect(getApi().state.duration).toBeGreaterThan(0));

    unmount();
  });

  it("calls onSectionComplete after the final chunk", async () => {
    vi.mocked(chunkText).mockReturnValue(["only chunk"]);
    const onSectionComplete = vi.fn();
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
      onSectionComplete,
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    act(() => {
      (
        FakeAudioContext.instances[0]?.lastSource as any
      )?.onended?.(new Event("ended"));
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("ENDED"));

    expect(onSectionComplete).toHaveBeenCalled();

    unmount();
  });

  it("pauses playback and suspends the audio context", async () => {
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    act(() => {
      getApi().pause();
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PAUSED"));

    unmount();
  });

  it("resumes playback from the current chunk", async () => {
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    // ponytail: prefetch means chunk two was already synthesized by the time
    // chunk one started playing.
    await vi.waitFor(() =>
      expect(mockEngine.synthesize).toHaveBeenCalledTimes(2),
    );

    act(() => {
      getApi().pause();
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PAUSED"));

    act(() => {
      getApi().resume();
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    // ponytail: resume continues the frozen source — no new synthesis and no
    // replay-from-zero (the source was suspended, not destroyed).
    expect(mockEngine.synthesize).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("closes and resets state", async () => {
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    act(() => {
      getApi().close();
    });

    expect(getApi().state.phase).toBe("IDLE");
    expect(getApi().state.sectionTitle).toBe("");

    unmount();
  });

  it("returns null from getCurrentChunk during a section transition", async () => {
    // ponytail: stall getText so we can inspect the window between startSection
    // clearing the old chunks and the new section's chunks being computed.
    const getText = vi.fn(() => new Promise<string>(() => {}));
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText,
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });

    expect(getApi().getCurrentChunk()).toBeNull();

    unmount();
  });

  it("returns the current chunk while paused", async () => {
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    act(() => {
      getApi().pause();
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PAUSED"));

    expect(getApi().getCurrentChunk()).toEqual({
      sectionHref: "xhtml/chapter1.xhtml",
      chunkText: "chunk one",
    });

    unmount();
  });

  it("fades the chunk highlight out on pause and back in on resume", async () => {
    const viewerRef = createMockViewerRef();
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
      viewerRef,
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    act(() => {
      getApi().pause();
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PAUSED"));
    expect(viewerRef!.current!.setTtsPaused).toHaveBeenCalledWith(true);

    act(() => {
      getApi().resume();
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));
    expect(viewerRef!.current!.setTtsPaused).toHaveBeenCalledWith(false);

    unmount();
  });

  it("clears the paused highlight state on close", async () => {
    const viewerRef = createMockViewerRef();
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
      viewerRef,
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));
    act(() => {
      getApi().pause();
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PAUSED"));

    act(() => {
      getApi().close();
    });

    expect(viewerRef!.current!.setTtsPaused).toHaveBeenLastCalledWith(false);
    expect(viewerRef!.current!.clearTtsHighlight).toHaveBeenCalled();

    unmount();
  });

  it("reports an empty section as ENDED and calls onSectionComplete", async () => {
    const onSectionComplete = vi.fn();
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("   "),
      engineId: "kokoro",
      voiceId: "af_bella",
      onSectionComplete,
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("ENDED"));

    expect(mockEngine.ensureLoaded).not.toHaveBeenCalled();
    expect(onSectionComplete).toHaveBeenCalled();

    unmount();
  });

  it("surfaces an error when ensureLoaded fails", async () => {
    mockEngine.ensureLoaded.mockRejectedValue(new Error("Model failed to load"));

    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("IDLE"));

    expect(getApi().state.error).toBe("Model failed to load");

    unmount();
  });

  it("surfaces an error when synthesize fails", async () => {
    mockEngine.synthesize.mockRejectedValue(new Error("Synthesis failed"));

    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("IDLE"));

    expect(getApi().state.error).toBe("Synthesis failed");

    unmount();
  });

  it("falls back to the browser engine when the primary model fails to load", async () => {
    // ponytail: Task 8 — fallback swap path. Primary throws on ensureLoaded,
    // hook toasts, swaps to browser engine, and uses browser chunk limits.
    const primaryEngine = {
      ...createMockEngine(),
      id: "kokoro",
      ensureLoaded: vi.fn().mockRejectedValue(new Error("no WebGPU")),
    };
    const browserEngine = {
      id: "browser",
      label: "Browser",
      getVoices: vi.fn(() => []),
      supportsLanguage: vi.fn(() => true),
      ensureLoaded: vi.fn().mockResolvedValue(undefined),
      synthesize: vi.fn().mockResolvedValue({
        kind: "url" as const,
        url: "",
      }),
    };
    vi.mocked(getEngine).mockImplementation(async (id) =>
      id === "browser"
        ? (browserEngine as any)
        : (primaryEngine as any),
    );
    vi.mocked(chunkText).mockReturnValue(["only chunk"]);

    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      getText: createGetText("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    await act(async () => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() =>
      expect(browserEngine.synthesize).toHaveBeenCalledWith(
        "only chunk",
        { voiceId: "af_bella", lang: "en", speed: 1 },
      ),
    );

    expect(toast).toHaveBeenCalledWith("Switching to built-in voice");
    expect(chunkText).toHaveBeenCalledWith(
      "Hello world.",
      expect.objectContaining({ softLimit: 400, hardLimit: 500 }),
    );
    expect(primaryEngine.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(browserEngine.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(getApi().state.error).toBeUndefined();
    // ponytail: fix for review finding — the fallback swap must be visible to
    // consumers so the voice picker can refresh to browser voices.
    expect(getApi().effectiveEngineId).toBe("browser");

    unmount();
  });
});
