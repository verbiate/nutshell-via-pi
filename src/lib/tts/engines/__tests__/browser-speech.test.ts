import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { browserSpeechEngine } from "../browser-speech-engine";

// ponytail: stub SpeechSynthesis* with just the surface area the engine
// touches. DOM lib types are global; we shape the fakes to satisfy TS by
// casting at the install boundary.

class FakeVoice {
  name: string;
  lang: string;
  voiceURI: string;
  constructor(name: string, lang: string) {
    this.name = name;
    this.lang = lang;
    this.voiceURI = `${name}-${lang}`;
  }
}

interface FakeUtterance {
  text: string;
  lang: string;
  rate: number;
  voice: FakeVoice | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

class FakeSpeechSynthesis {
  voices: FakeVoice[] = [];
  speakCalls: FakeUtterance[] = [];
  cancelled = false;
  paused = false;
  private listeners = new Map<string, Set<() => void>>();

  getVoices(): FakeVoice[] {
    return this.voices;
  }
  speak(u: FakeUtterance): void {
    this.speakCalls.push(u);
  }
  cancel(): void {
    this.cancelled = true;
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  addEventListener(type: string, fn: () => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  fireVoicesChanged(): void {
    for (const fn of this.listeners.get("voiceschanged") ?? []) fn();
  }
}

let fake: FakeSpeechSynthesis;
let utterances: FakeUtterance[];

class FakeUtteranceCtor {
  text: string;
  lang = "";
  rate = 1;
  voice: FakeVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  static created: FakeUtterance[] = [];
  constructor(text: string) {
    this.text = text;
    FakeUtteranceCtor.created.push(this);
  }
}

beforeEach(() => {
  fake = new FakeSpeechSynthesis();
  FakeUtteranceCtor.created = [];
  utterances = FakeUtteranceCtor.created;
  (globalThis as any).speechSynthesis = fake;
  (globalThis as any).SpeechSynthesisUtterance = FakeUtteranceCtor;
});

afterEach(() => {
  delete (globalThis as any).speechSynthesis;
  delete (globalThis as any).SpeechSynthesisUtterance;
  vi.useRealTimers();
});

describe("browserSpeechEngine", () => {
  it("exposes id, label, and supports every language", () => {
    expect(browserSpeechEngine.id).toBe("browser");
    expect(browserSpeechEngine.label).toBeTruthy();
    expect(browserSpeechEngine.supportsLanguage("en")).toBe(true);
    expect(browserSpeechEngine.supportsLanguage("zz")).toBe(true);
  });

  it("filters voices by language prefix", () => {
    fake.voices = [
      new FakeVoice("Alex", "en-US"),
      new FakeVoice("Thomas", "de-DE"),
      new FakeVoice("Samantha", "en-GB"),
    ];
    const en = browserSpeechEngine.getVoices("en");
    expect(en).toHaveLength(2);
    expect(en.map((v) => v.label).sort()).toEqual(["Alex", "Samantha"]);
  });

  it("returns an empty voice list when speechSynthesis is missing", () => {
    delete (globalThis as any).speechSynthesis;
    expect(browserSpeechEngine.getVoices("en")).toEqual([]);
  });

  it("ensureLoaded resolves immediately when voices already exist", async () => {
    fake.voices = [new FakeVoice("Alex", "en-US")];
    await expect(browserSpeechEngine.ensureLoaded()).resolves.toBeUndefined();
  });

  it("ensureLoaded waits for voiceschanged when the initial list is empty", async () => {
    setTimeout(() => {
      fake.voices = [new FakeVoice("Alex", "en-US")];
      fake.fireVoicesChanged();
    }, 5);
    await expect(browserSpeechEngine.ensureLoaded()).resolves.toBeUndefined();
  });

  it("ensureLoaded gives up after the 1s ceiling if voiceschanged never fires", async () => {
    vi.useFakeTimers();
    const p = browserSpeechEngine.ensureLoaded();
    vi.advanceTimersByTime(1100);
    await expect(p).resolves.toBeUndefined();
  });

  it("ensureLoaded rejects when speechSynthesis is unavailable", async () => {
    delete (globalThis as any).speechSynthesis;
    await expect(browserSpeechEngine.ensureLoaded()).rejects.toThrow(
      /not available/,
    );
  });

  it("synthesize creates an utterance, sets voice + rate, speaks, and resolves on end", async () => {
    const voice = new FakeVoice("Alex", "en-US");
    fake.voices = [voice];
    const promise = browserSpeechEngine.synthesize("hello world", {
      voiceId: voice.voiceURI,
      lang: "en",
      speed: 1.5,
    });

    // ponytail: voice/rate are set after `await waitForVoices` — flush
    // microtasks until speak() fires, then assert utterance state.
    await vi.waitFor(() => expect(fake.speakCalls).toHaveLength(1));

    const utter = utterances[0];
    expect(utter.text).toBe("hello world");
    expect(utter.voice?.voiceURI).toBe(voice.voiceURI);
    expect(utter.rate).toBe(1.5);

    utter.onend?.();
    await expect(promise).resolves.toEqual({ kind: "url", url: "" });
  });

  it("synthesize falls back to lang-only when voiceId does not match", async () => {
    fake.voices = [new FakeVoice("Alex", "en-US")];
    const promise = browserSpeechEngine.synthesize("hi", {
      voiceId: "nonexistent",
      lang: "fr",
    });

    await vi.waitFor(() => expect(fake.speakCalls).toHaveLength(1));

    const utter = utterances[0];
    expect(utter.voice).toBeNull();
    expect(utter.lang).toBe("fr");

    utter.onend?.();
    await expect(promise).resolves.toEqual({ kind: "url", url: "" });
  });

  it("synthesize rejects when the utterance errors", async () => {
    // ponytail: voice present so waitForVoices resolves immediately; the
    // error path we're exercising is the utterance onerror, not voice load.
    fake.voices = [new FakeVoice("Alex", "en-US")];
    const promise = browserSpeechEngine.synthesize("hi", {
      voiceId: "",
      lang: "en",
    });
    await vi.waitFor(() => expect(fake.speakCalls).toHaveLength(1));
    utterances[0].onerror?.({ error: "synthesis-unavailable" });
    await expect(promise).rejects.toThrow(/synthesis-unavailable/);
  });
});
