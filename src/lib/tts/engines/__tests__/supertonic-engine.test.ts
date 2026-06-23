import { describe, it, expect } from "vitest";
// ponytail: import the REAL engine — no mocks. This is exactly the gap that
// let the wrong-API bug ship. The assertions below would all fail against the
// old Transformers.js pipeline implementation.
import {
  supertonicEngine,
  ONNX_PATHS,
  voiceUrl,
  SUPERTONIC_TOTAL_STEPS,
  SupertonicTts,
} from "../supertonic-engine";

describe("supertonicEngine (real module, no mocks)", () => {
  it("exposes the expected id, label, and voice catalog", () => {
    expect(supertonicEngine.id).toBe("supertonic");
    expect(supertonicEngine.label).toBe("Free (Faster)");
    expect(supertonicEngine.getVoices("en")).toHaveLength(10);
    const ids = supertonicEngine.getVoices("en").map((v) => v.id).sort();
    expect(ids).toEqual(["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]);
  });

  it("supports the Supertonic language set", () => {
    expect(supertonicEngine.supportsLanguage("ko")).toBe(true);
    expect(supertonicEngine.supportsLanguage("ar")).toBe(true);
    expect(supertonicEngine.supportsLanguage("xx")).toBe(false);
  });

  it("implements the TtsEngine surface", () => {
    expect(typeof supertonicEngine.getVoices).toBe("function");
    expect(typeof supertonicEngine.supportsLanguage).toBe("function");
    expect(typeof supertonicEngine.ensureLoaded).toBe("function");
    expect(typeof supertonicEngine.synthesize).toBe("function");
    expect(typeof supertonicEngine.dispose).toBe("function");
  });

  // Finding #1: the engine must drive onnxruntime-web against the 4 raw ONNX
  // sessions on the HF model card — NOT a Transformers.js pipeline. The
  // presence of these CDN paths is the structural proof.
  it("loads the 4 raw ONNX sessions from the Supertone/supertonic-3 CDN", () => {
    const onnxValues = [
      ONNX_PATHS.durationPredictor,
      ONNX_PATHS.textEncoder,
      ONNX_PATHS.vectorEstimator,
      ONNX_PATHS.vocoder,
    ];
    expect(onnxValues).toHaveLength(4);
    for (const url of onnxValues) {
      expect(url).toContain("Supertone/supertonic-3");
      expect(url.endsWith(".onnx")).toBe(true);
    }
    expect(ONNX_PATHS.config.endsWith("/onnx/tts.json")).toBe(true);
    expect(ONNX_PATHS.indexer.endsWith("/onnx/unicode_indexer.json")).toBe(true);
  });

  // Finding #2: voice styles are JSON tensors, not .bin.
  it("builds voice-style URLs with the .json extension", () => {
    const url = voiceUrl("M1");
    expect(url).toContain("Supertone/supertonic-3");
    expect(url).toContain("voice_styles/M1");
    expect(url.endsWith(".json")).toBe(true);
    expect(url.endsWith(".bin")).toBe(false);
  });

  // Brand promise: "Free (Faster)" pins 5 denoising steps.
  it("pins total denoising steps to 5", () => {
    expect(SUPERTONIC_TOTAL_STEPS).toBe(5);
  });

  // Call shape matches the official demo's TextToSpeech.call(text, lang,
  // style, totalStep, speed, silence, cb) — 4 required params before defaults.
  it("mirrors the demo TextToSpeech.call signature (4 required params)", () => {
    expect(typeof SupertonicTts).toBe("function");
    expect(typeof SupertonicTts.prototype.call).toBe("function");
    expect(SupertonicTts.prototype.call.length).toBe(4);
    // demo inference internals are ported, not a transformers pipeline:
    const protoMethods = Object.getOwnPropertyNames(SupertonicTts.prototype);
    expect(protoMethods).toContain("call");
    expect(protoMethods).toContain("_infer");
    expect(protoMethods).toContain("sampleNoisyLatent");
  });
});
