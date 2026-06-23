import { describe, it, expect } from "vitest";
import { KOKORO_VOICES } from "../voices/kokoro";
import { SUPERTONIC_VOICES } from "../voices/supertonic";

describe("Kokoro voices", () => {
  it("has the expected voice counts per language", () => {
    expect(KOKORO_VOICES.en.length).toBe(28);
    expect(KOKORO_VOICES.es.length).toBe(3);
    expect(KOKORO_VOICES.fr.length).toBe(1);
    expect(KOKORO_VOICES.hi.length).toBe(4);
    expect(KOKORO_VOICES.it.length).toBe(2);
    expect(KOKORO_VOICES.ja.length).toBe(5);
    expect(KOKORO_VOICES.pt.length).toBe(3);
    expect(KOKORO_VOICES.zh.length).toBe(8);
  });

  it("tags all English voices with US or GB region", () => {
    for (const voice of KOKORO_VOICES.en) {
      expect(voice.region).toBeOneOf(["US", "GB"]);
    }
  });

  it("keeps US and GB counts distinct", () => {
    const usCount = KOKORO_VOICES.en.filter((v) => v.region === "US").length;
    const gbCount = KOKORO_VOICES.en.filter((v) => v.region === "GB").length;
    expect(usCount).toBe(20);
    expect(gbCount).toBe(8);
  });

  it("only includes female or male gender values", () => {
    for (const voices of Object.values(KOKORO_VOICES)) {
      for (const voice of voices) {
        expect(voice.gender).toBeOneOf(["female", "male"]);
      }
    }
  });
});

describe("Supertonic voices", () => {
  it("has 10 voices", () => {
    expect(SUPERTONIC_VOICES.length).toBe(10);
  });

  it("has 5 male and 5 female voices", () => {
    const males = SUPERTONIC_VOICES.filter((v) => v.gender === "male").length;
    const females = SUPERTONIC_VOICES.filter((v) => v.gender === "female").length;
    expect(males).toBe(5);
    expect(females).toBe(5);
  });

  it("has sequential ids M1-M5 and F1-F5", () => {
    const ids = SUPERTONIC_VOICES.map((v) => v.id);
    expect(ids).toEqual(["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"]);
  });
});
