import type { TtsEngine, TtsVoice, SynthesizeOpts, TtsSynthesisResult } from "../types";
import { KOKORO_VOICES } from "../voices/kokoro";
import { KOKORO_LANGUAGES } from "../languages";
import { phonemize } from "../phonemizer-cdn";
import { chunkText } from "../chunk";

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

export function concatFloat32(parts: Float32Array[], silenceSamples: number): Float32Array {
  if (parts.length === 0) return new Float32Array(0);
  if (parts.length === 1) return parts[0]!;

  const total =
    parts.reduce((sum, p) => sum + p.length, 0) + silenceSamples * (parts.length - 1);
  const out = new Float32Array(total);
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    out.set(p, offset);
    offset += p.length;
    if (i < parts.length - 1) {
      offset += silenceSamples;
    }
  }
  return out;
}

function withOrtNoiseSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  const noisy = /VerifyEachNodeIsAssignedToAnEp|Rerunning with verbose output/;
  const origError: Console["error"] = console.error;
  const origWarn: Console["warn"] = console.warn;
  const suppress = (...args: unknown[]) =>
    args.some((a) => typeof a === "string" && noisy.test(a));

  console.error = (...args) => {
    if (!suppress(...args)) origError(...args);
  };
  console.warn = (...args) => {
    if (!suppress(...args)) origWarn(...args);
  };

  return Promise.resolve(fn()).finally(() => {
    console.error = origError;
    console.warn = origWarn;
  });
}

export const kokoroEngine: TtsEngine = (() => {
  let ttsPromise: Promise<KokoroTtsInstance> | null = null;

  async function getTts(onProgress?: (pct: number) => void) {
    if (!ttsPromise) {
      ttsPromise = (async () => {
        const { KokoroTTS } = await import("kokoro-js");
        // ponytail: transformers.js derives ORT's session logSeverityLevel from
        // env.logLevel. The default emits the benign "[W:onnxruntime:...]
        // VerifyEachNodeIsAssignedToAnEp" hints at error level during session
        // creation (shape ops on CPU is by design) — set to ERROR to suppress.
        // Some ORT-web builds still leak the warning via console, so we also
        // filter it for the duration of model load.
        const { env, LogLevel } = await import("@huggingface/transformers");
        env.logLevel = LogLevel.ERROR;
        return withOrtNoiseSuppressed(async () => {
          const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
            // ponytail: was "q8" — q8 + webgpu garbles the waveform. kokoro-js
            // README: "If using webgpu, we recommend dtype=fp32." fp32 matches the
            // "Highest Quality" label; costs a one-time ~320MB download on first load.
            dtype: "fp32",
            device: "webgpu",
            progress_callback: onProgress
              ? (progress: { status: string; file?: string; progress?: number }) => {
                  if (typeof progress.progress === "number") {
                    onProgress(progress.progress);
                  }
                }
              : undefined,
          });
          return tts as KokoroTtsInstance;
        });
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
      // ponytail: guard against the phonemize endpoint silently returning
      // empty (e.g. a Turbopack resolveAlias regression loading the stub).
      // Empty IPA still yields non-empty audio from the model, so without this
      // check Kokoro plays gibberish and ensureLoaded appears to succeed.
      if (!phonemes.trim()) {
        throw new Error("phonemize returned empty IPA — server stub regression?");
      }
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
      const speed = opts.speed ?? 1;
      // ponytail: Kokoro's positional ceiling is ~510 phoneme tokens; the tokenizer
      // (truncation:true) silently drops anything longer, so re-split at sentence
      // boundaries and concatenate — same pattern supertonic-engine uses. 220 chars
      // stays well under 510 tokens for English; truncation:true is now a backstop.
      const pieces = chunkText(text, { softLimit: 160, hardLimit: 220 });
      const parts: Float32Array[] = [];
      let samplingRate = 24000;

      for (const piece of pieces) {
        if (!piece.trim()) continue;
        const phonemes = await phonemize(piece, opts.voiceId);
        const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
        const result = await tts.generate_from_ids(input_ids, {
          voice: opts.voiceId,
          speed,
        });
        if (!result?.audio?.length) {
          throw new Error("Kokoro synthesis produced no audio");
        }
        samplingRate = result.sampling_rate;
        parts.push(result.audio);
      }

      if (parts.length === 0) {
        throw new Error("Kokoro synthesis produced no audio");
      }

      const audio = concatFloat32(parts, Math.floor(0.05 * samplingRate));
      const buffer = await rawAudioToAudioBuffer(audio, samplingRate);
      return { kind: "audioBuffer", buffer };
    },
    dispose() {
      ttsPromise = null;
    },
  };
})();
