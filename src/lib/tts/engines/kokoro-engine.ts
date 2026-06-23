import type { TtsEngine, TtsVoice, SynthesizeOpts, TtsSynthesisResult } from "../types";
import { KOKORO_VOICES } from "../voices/kokoro";
import { KOKORO_LANGUAGES } from "../languages";
import { phonemize } from "../phonemizer-cdn";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// ponytail: we only use tokenizer + generate_from_ids, bypassing kokoro-js's
// generate() which internally imports phonemizer (broken under Turbopack).
// Phonemization is done server-side via /api/tts/phonemize.
interface KokoroTtsInstance {
  tokenizer: (text: string, opts: { truncation: boolean }) => { input_ids: { dims: number[] } };
  generate_from_ids(
    inputIds: unknown,
    opts: { voice: string; speed?: number },
  ): Promise<{ audio: Float32Array; sampling_rate: number }>;
}

async function rawAudioToAudioBuffer(
  audio: Float32Array,
  samplingRate: number,
): Promise<AudioBuffer> {
  const ctx = new AudioContext({ sampleRate: samplingRate });
  const buffer = ctx.createBuffer(1, audio.length, samplingRate);
  buffer.getChannelData(0).set(audio);
  return buffer;
}

export const kokoroEngine: TtsEngine = (() => {
  let ttsPromise: Promise<KokoroTtsInstance> | null = null;

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
        }) as Promise<KokoroTtsInstance>;
      })();
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
      // Validate the full pipeline: server phonemize → tokenize → model.
      const phonemes = await phonemize("test", "af_bella");
      const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
      const TEST_TIMEOUT_MS = 15_000;
      const result = await Promise.race([
        tts.generate_from_ids(input_ids, { voice: "af_bella" }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Kokoro test synthesis timed out")),
            TEST_TIMEOUT_MS,
          ),
        ),
      ]);
      if (!result?.audio?.length) {
        throw new Error("Kokoro test synthesis produced no audio");
      }
    },
    async synthesize(text: string, opts: SynthesizeOpts): Promise<TtsSynthesisResult> {
      const tts = await getTts();
      const phonemes = await phonemize(text, opts.voiceId);
      const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
      const result = await tts.generate_from_ids(input_ids, {
        voice: opts.voiceId,
        speed: opts.speed ?? 1,
      });
      if (!result?.audio?.length) {
        throw new Error("Kokoro synthesis produced no audio");
      }
      const buffer = await rawAudioToAudioBuffer(result.audio, result.sampling_rate);
      return { kind: "audioBuffer", buffer };
    },
    dispose() {
      ttsPromise = null;
    },
  };
})();
