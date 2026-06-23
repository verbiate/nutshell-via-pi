import { describe, it, expect } from "vitest";
import { getEngine, ENGINES } from "../index";

describe("TTS engine registry", () => {
  it("returns the Kokoro engine with the expected label and voice count", async () => {
    const engine = await getEngine("kokoro");
    expect(engine.label).toBe("Free (Highest Quality)");
    expect(engine.getVoices("en").length).toBe(28);
    expect(engine.getVoices("zh").length).toBe(8);
  });

  it("returns the Supertonic engine with the expected label and voice count", async () => {
    const engine = await getEngine("supertonic");
    expect(engine.label).toBe("Free (Faster)");
    expect(engine.getVoices("en").length).toBe(10);
  });

  it("wires the browser fallback engine and leaves the cloud slot empty", () => {
    expect(ENGINES.cloud).toBeNull();
    expect(ENGINES.browser).not.toBeNull();
    expect(ENGINES.browser?.id).toBe("browser");
  });

  it("throws for the unavailable cloud engine", async () => {
    await expect(getEngine("cloud")).rejects.toThrow('Engine "cloud" not available');
  });
});
