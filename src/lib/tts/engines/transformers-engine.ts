import type { TtsEngine, TtsVoice, SynthesizeOpts, TtsSynthesisResult } from "../types";

export interface TransformersConfig {
  engineId: string;
  label: string;
  modelId: string;
  dtype?: "fp32" | "fp16" | "q8" | "q4";
  getVoices: (lang: string) => TtsVoice[];
  supportsLanguage?: (lang: string) => boolean;
  voiceOptions: (voiceId: string, lang: string) => Record<string, unknown>;
  synthesisOverrides?: Record<string, unknown>;
}

interface RawAudio {
  audio: Float32Array;
  sampling_rate: number;
}

function isRawAudio(value: unknown): value is RawAudio {
  return (
    typeof value === "object" &&
    value !== null &&
    "audio" in value &&
    value.audio instanceof Float32Array &&
    "sampling_rate" in value &&
    typeof value.sampling_rate === "number"
  );
}

async function rawAudioToAudioBuffer(raw: RawAudio): Promise<AudioBuffer> {
  const ctx = new AudioContext({ sampleRate: raw.sampling_rate });
  const buffer = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
  buffer.getChannelData(0).set(raw.audio);
  return buffer;
}

export function createTransformersEngine(cfg: TransformersConfig): TtsEngine {
  let pipelinePromise: Promise<unknown> | null = null;

  async function getPipeline(onProgress?: (pct: number) => void) {
    if (!pipelinePromise) {
      pipelinePromise = (async () => {
        const { pipeline } = await import("@huggingface/transformers");
        return pipeline("text-to-speech", cfg.modelId, {
          dtype: cfg.dtype ?? "q8",
          device: "webgpu",
          progress_callback: onProgress
            ? (progress: { status: string; file?: string; progress?: number }) => {
                if (typeof progress.progress === "number") {
                  onProgress(progress.progress);
                }
              }
            : undefined,
        });
      })();
    }
    return pipelinePromise;
  }

  return {
    id: cfg.engineId,
    label: cfg.label,
    getVoices: cfg.getVoices,
    supportsLanguage: cfg.supportsLanguage ?? (() => true),
    ensureLoaded(onProgress) {
      return getPipeline(onProgress).then(() => undefined);
    },
    async synthesize(text: string, opts: SynthesizeOpts): Promise<TtsSynthesisResult> {
      const pipe = await getPipeline();
      const callable = pipe as (text: string, options: Record<string, unknown>) => Promise<unknown>;
      const result = await callable(text, {
        ...cfg.synthesisOverrides,
        ...cfg.voiceOptions(opts.voiceId, opts.lang),
        ...(opts.speed ? { speed: opts.speed } : {}),
      });

      if (!isRawAudio(result)) {
        throw new Error(`Unexpected TTS output shape for engine "${cfg.engineId}"`);
      }

      const buffer = await rawAudioToAudioBuffer(result);
      return { kind: "audioBuffer", buffer };
    },
    dispose() {
      pipelinePromise = null;
    },
  };
}
