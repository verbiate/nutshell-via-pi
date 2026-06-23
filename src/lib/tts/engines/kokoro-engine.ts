import type { TtsEngine, TtsVoice, SynthesizeOpts, TtsSynthesisResult } from "../types";
import { KOKORO_VOICES } from "../voices/kokoro";
import { KOKORO_LANGUAGES } from "../languages";
import { phonemize } from "../phonemizer-cdn";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// ponytail: we only use tokenizer + generate_from_ids, bypassing kokoro-js's
// generate() which internally imports phonemizer (broken under Turbopack).
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
  let phonemizerReady: Promise<void> | null = null;

  async function ensurePhonemizer() {
    if (!phonemizerReady) {
      phonemizerReady = phonemize("test", "en-us").then(() => undefined);
    }
    return phonemizerReady;
  }

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
      // Load model and CDN phonemizer in parallel, then validate the full
      // pipeline with a tiny test synthesis. The CDN phonemizer bypasses
      // Turbopack's broken Emscripten transform (see phonemizer-cdn.ts).
      const tts = await getTts(onProgress);
      await ensurePhonemizer();
      const phonemes = (await phonemize("test", "en-us")).join(" ");
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
      await ensurePhonemizer();
      const lang = opts.lang === "en" ? "en-us" : opts.lang;
      const raw = (await phonemize(text, lang)).join(" ");

      // ponytail: kokoro-js's generate() applies critical IPA post-processing
      // that converts eSpeak NG output to the phoneme set Kokoro expects.
      // Without these replacements (especially r→ɹ) the audio is garbled.
      // Ported verbatim from kokoro-js's internal m() function.
      let phonemes = raw
        .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
        .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹoʊ")
        .replace(/ʲ/g, "j")
        .replace(/r/g, "ɹ")
        .replace(/x/g, "k")
        .replace(/ɬ/g, "l")
        .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
        .replace(/ z(?=[;:,.!?¡¿—…"«»"" ]|$)/g, "z");
      if (lang === "en-us") {
        phonemes = phonemes.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
      }
      phonemes = phonemes.trim();

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
      phonemizerReady = null;
    },
  };
})();
