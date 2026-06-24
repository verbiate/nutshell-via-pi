import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  countWords,
  estimateSeconds,
  deriveWpm,
  getCachedWpm,
  setCachedWpm,
  cacheKey,
  FALLBACK_WPM,
  _resetWpmCache,
} from "../estimate";

// ponytail: vitest runs in the `node` environment (no DOM), so stub a
// localStorage on globalThis. The estimate module reads/writes it via
// globalThis.localStorage; in a real browser that resolves to window.localStorage.
function installLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as Storage;
}

describe("tts/estimate", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", installLocalStorageMock());
    _resetWpmCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("countWords", () => {
    it("counts whitespace-separated tokens", () => {
      expect(countWords("one two three")).toBe(3);
    });

    it("tolerates irregular whitespace and newlines", () => {
      expect(countWords("  leading\n\nspaces   \ttabs  ")).toBe(3);
    });

    it("returns 0 for empty / whitespace-only text", () => {
      expect(countWords("")).toBe(0);
      expect(countWords("   \n\t ")).toBe(0);
    });
  });

  describe("estimateSeconds", () => {
    it("computes minutes of audio at a given WPM and 1x speed", () => {
      // 170 words @ 170 wpm, 1x → 60s.
      expect(estimateSeconds(170, 170, 1)).toBeCloseTo(60, 6);
    });

    it("scales duration inversely with speed", () => {
      // 2x speed halves duration.
      expect(estimateSeconds(170, 170, 2)).toBeCloseTo(30, 6);
      // 0.5x speed doubles duration.
      expect(estimateSeconds(170, 170, 0.5)).toBeCloseTo(120, 6);
    });

    it("never divides by zero for degenerate wpm/speed", () => {
      expect(estimateSeconds(100, 0, 1)).toBeGreaterThan(0);
      expect(estimateSeconds(100, 170, 0)).toBeGreaterThan(0);
    });
  });

  describe("deriveWpm", () => {
    it("derives words-per-minute from a measured span", () => {
      // 100 words in 40s → 150 wpm.
      expect(deriveWpm(100, 40)).toBeCloseTo(150, 6);
    });

    it("falls back when duration is non-positive", () => {
      expect(deriveWpm(100, 0)).toBe(FALLBACK_WPM);
      expect(deriveWpm(100, -5)).toBe(FALLBACK_WPM);
    });
  });

  describe("WPM cache", () => {
    it("round-trips a measured rate through the cache", () => {
      expect(getCachedWpm("kokoro", "af_bella")).toBeNull();
      setCachedWpm("kokoro", "af_bella", 183.5);
      expect(getCachedWpm("kokoro", "af_bella")).toBeCloseTo(183.5, 6);
    });

    it("persists to and rehydrates from localStorage across sessions", () => {
      // Session A: writing caches the value in-session AND in storage.
      setCachedWpm("supertonic", "en_speaker_0", 160);
      expect(
        JSON.parse(globalThis.localStorage.getItem("nutshell:tts-wpm")!)[
          cacheKey("supertonic", "en_speaker_0")
        ],
      ).toBeCloseTo(160, 6);

      // Session B: a fresh module load starts with an empty in-session map, so
      // getCachedWpm must rehydrate from storage. Simulate that by clearing only
      // the in-session cache while keeping storage intact.
      _resetWpmCache();
      globalThis.localStorage.setItem(
        "nutshell:tts-wpm",
        JSON.stringify({ [cacheKey("supertonic", "en_speaker_0")]: 160 }),
      );
      expect(getCachedWpm("supertonic", "en_speaker_0")).toBeCloseTo(160, 6);
    });

    it("ignores non-positive writes", () => {
      setCachedWpm("kokoro", "af_bella", 0);
      expect(getCachedWpm("kokoro", "af_bella")).toBeNull();
      setCachedWpm("kokoro", "af_bella", Number.NaN);
      expect(getCachedWpm("kokoro", "af_bella")).toBeNull();
    });
  });
});
