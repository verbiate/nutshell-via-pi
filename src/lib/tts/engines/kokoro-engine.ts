import type { TtsEngine, TtsVoice, SynthesizeOpts, TtsSynthesisResult } from "../types";
import { KOKORO_VOICES } from "../voices/kokoro";
import { KOKORO_LANGUAGES } from "../languages";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

interface KokoroTts {
  generate(text: string, options: { voice: string }): Promise<unknown>;
}

interface KokoroAudio {
  audio: Float32Array;
  sampling_rate: number;
}

function isKokoroAudio(value: unknown): value is KokoroAudio {
  return (
    typeof value === "object" &&
    value !== null &&
    "audio" in value &&
    value.audio instanceof Float32Array &&
    "sampling_rate" in value &&
    typeof value.sampling_rate === "number"
  );
}

async function rawAudioToAudioBuffer(raw: KokoroAudio): Promise<AudioBuffer> {
  const ctx = new AudioContext({ sampleRate: raw.sampling_rate });
  const buffer = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
  buffer.getChannelData(0).set(raw.audio);
  return buffer;
}

export const kokoroEngine: TtsEngine = (() => {
  let ttsPromise: Promise<KokoroTts> | null = null;

  async function getTts(onProgress?: (pct: number) => void) {
    if (!ttsPromise) {
      ttsPromise = (async () => {
        const { KokoroTTS } = await import("kokoro-js");
        return KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: "q8",
          device: "webgpu",
          progress_callback: onProgress
            ? (progress: { status: string; file?: string; progress?: number }) => {
                if (typeof progress.progress === "number") {
                  onProgress(progress.progress);
                }
              }
            : undefined,
        }) as Promise<KokoroTts>;
      })();
      // ponytail: reset ttsPromise on rejection so a failed load (e.g. no
      // WebGPU) doesn't permanently poison the cache. Without this, once Kokoro
      // fails it can never retry for the rest of the session.
      ttsPromise.catch(() => {
        ttsPromise = null;
      });
    }
    return ttsPromise;
  }

  return {
    id: "kokoro",
    label: "Free (Highest Quality)",
    getVoices(lang: string): TtsVoice[] {
      const voices = KOKORO_VOICES[lang] ?? KOKORO_VOICES.en ?? [];
      return voices.map((v) => ({
        id: v.id,
        label: v.label,
        gender: v.gender,
        region: v.region,
      }));
    },
    supportsLanguage: (lang) => KOKORO_LANGUAGES.has(lang),
    async ensureLoaded(onProgress) {
      const tts = await getTts(onProgress);
      // ponytail: validate the full pipeline (phonemizer + model) with a tiny
      // test synthesis. kokoro-js's phonemizer crashes in some browser
      // environments (Turbopack/Next.js); without this check, the engine
      // "loads" successfully but silently produces no audio on every call.
      // A throw here triggers resolveEngine's browser fallback.
      //
      // The test synthesis has a 10s timeout — on a working system it completes
      // in <2s. If the phonemizer hangs (broken module), the timeout fires and
      // we fall back instead of blocking forever.
      const TEST_TIMEOUT_MS = 10_000;
      const result = await Promise.race([
        tts.generate("test", { voice: "af_bella" }) as Promise<unknown>,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Kokoro test synthesis timed out (phonemizer may be broken)")),
            TEST_TIMEOUT_MS,
          ),
        ),
      ]);
      if (!isKokoroAudio(result) || result.audio.length === 0) {
        throw new Error("Kokoro test synthesis produced no audio (phonemizer may be broken)");
      }
    },
    async synthesize(text: string, opts: SynthesizeOpts): Promise<TtsSynthesisResult> {
      const tts = await getTts();
      const result = await tts.generate(text, { voice: opts.voiceId });
      if (!isKokoroAudio(result)) {
        throw new Error('Unexpected Kokoro output shape');
      }
      const buffer = await rawAudioToAudioBuffer(result);
      return { kind: "audioBuffer", buffer };
    },
    dispose() {
      ttsPromise = null;
    },
  };
})();
