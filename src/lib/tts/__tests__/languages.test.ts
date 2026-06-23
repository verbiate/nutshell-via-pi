import { describe, it, expect } from "vitest";
import {
  KOKORO_LANGUAGES,
  SUPERTONIC_LANGUAGES,
  TTS_LANGUAGES,
  defaultEngineForLanguage,
  engineSupportsLanguage,
  type EngineId,
} from "../languages";

describe("TTS language sets", () => {
  it("has 32 total TTS languages", () => {
    expect(TTS_LANGUAGES.size).toBe(32);
  });

  it("has 8 Kokoro languages", () => {
    expect(KOKORO_LANGUAGES.size).toBe(8);
  });

  it("has 31 Supertonic languages", () => {
    expect(SUPERTONIC_LANGUAGES.size).toBe(31);
  });

  it("zh is Kokoro-only", () => {
    expect(KOKORO_LANGUAGES.has("zh")).toBe(true);
    expect(SUPERTONIC_LANGUAGES.has("zh")).toBe(false);
  });

  it("default engine picks kokoro when available, otherwise supertonic", () => {
    expect(defaultEngineForLanguage("en")).toBe("kokoro");
    expect(defaultEngineForLanguage("zh")).toBe("kokoro");
    expect(defaultEngineForLanguage("ar")).toBe("supertonic");
    expect(defaultEngineForLanguage("uk")).toBe("supertonic");
  });

  it("engineSupportsLanguage respects engine/language coverage", () => {
    expect(engineSupportsLanguage("kokoro", "en")).toBe(true);
    expect(engineSupportsLanguage("kokoro", "ar")).toBe(false);
    expect(engineSupportsLanguage("supertonic", "ar")).toBe(true);
    expect(engineSupportsLanguage("supertonic", "zh")).toBe(false);
    expect(engineSupportsLanguage("cloud", "xx")).toBe(true);
    expect(engineSupportsLanguage("browser", "xx")).toBe(true);
  });

  it("covers the union of both engine sets", () => {
    const union = new Set([...KOKORO_LANGUAGES, ...SUPERTONIC_LANGUAGES]);
    expect(union.size).toBe(TTS_LANGUAGES.size);
    for (const lang of union) {
      expect(TTS_LANGUAGES.has(lang)).toBe(true);
    }
  });
});
