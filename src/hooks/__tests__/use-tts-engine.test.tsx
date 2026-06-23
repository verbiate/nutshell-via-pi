// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { useTtsEngine, type UseTtsEngineOptions } from "../use-tts-engine";

vi.mock("@/lib/tts/engines", () => ({
  getEngine: vi.fn(),
}));

vi.mock("@/lib/tts/chunk", () => ({
  chunkText: vi.fn(),
  CHUNK_LIMITS: {
    kokoro: { softLimit: 400, hardLimit: 500 },
    supertonic: { softLimit: 400, hardLimit: 500 },
    cloud: { softLimit: 4500, hardLimit: 5000 },
  },
}));

import { getEngine } from "@/lib/tts/engines";
import { chunkText } from "@/lib/tts/chunk";

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

function createViewerRef(text: string) {
  return {
    current: {
      navigateTo: vi.fn(() => Promise.resolve()),
      getSectionText: vi.fn(() => text),
    } as unknown as import("@/components/reader/epub-viewer").EpubViewerHandle,
  };
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

describe("useTtsEngine", () => {
  let mockEngine: ReturnType<typeof createMockEngine>;

  beforeEach(() => {
    mockEngine = createMockEngine();
    vi.mocked(getEngine).mockResolvedValue(mockEngine as any);
    vi.mocked(chunkText).mockReturnValue(["chunk one", "chunk two"]);
    FakeAudioContext.instances = [];
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
      viewerRef: createViewerRef("Hello world."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });
    expect(getApi().state.phase).toBe("IDLE");
    unmount();
  });

  it("navigates, loads the engine, chunks text, and plays the first chunk", async () => {
    const viewerRef = createViewerRef("Hello world. This is a test.");
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      viewerRef,
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    expect(viewerRef.current.navigateTo).toHaveBeenCalledWith(
      "xhtml/chapter1.xhtml",
    );
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
      viewerRef: createViewerRef("Hello world. This is a test."),
      engineId: "kokoro",
      voiceId: "af_bella",
    });

    act(() => {
      getApi().startSection("xhtml/chapter1.xhtml", "Chapter 1");
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    expect(mockEngine.synthesize).toHaveBeenCalledTimes(1);

    act(() => {
      const ctx = FakeAudioContext.instances[0];
      const source = ctx?.lastSource;
      expect(source).toBeTruthy();
      (source as any).onended?.(new Event("ended"));
    });
    await vi.waitFor(() =>
      expect(mockEngine.synthesize).toHaveBeenCalledTimes(2),
    );

    expect(mockEngine.synthesize).toHaveBeenLastCalledWith("chunk two", {
      voiceId: "af_bella",
      lang: "en",
      speed: 1,
    });

    unmount();
  });

  it("calls onSectionComplete after the final chunk", async () => {
    vi.mocked(chunkText).mockReturnValue(["only chunk"]);
    const onSectionComplete = vi.fn();
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      viewerRef: createViewerRef("Hello world."),
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
      viewerRef: createViewerRef("Hello world."),
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
      viewerRef: createViewerRef("Hello world."),
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

    act(() => {
      getApi().resume();
    });
    await vi.waitFor(() => expect(getApi().state.phase).toBe("PLAYING"));

    expect(mockEngine.synthesize).toHaveBeenLastCalledWith("chunk one", {
      voiceId: "af_bella",
      lang: "en",
      speed: 1,
    });

    unmount();
  });

  it("closes and resets state", async () => {
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      viewerRef: createViewerRef("Hello world."),
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

  it("reports an empty section as ENDED and calls onSectionComplete", async () => {
    const onSectionComplete = vi.fn();
    const { getApi, unmount } = renderHook({
      bookId: "book-1",
      bookLanguage: "en",
      viewerRef: createViewerRef("   "),
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
});
