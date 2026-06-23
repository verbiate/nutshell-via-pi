import type {
  SynthesizeOpts,
  TtsEngine,
  TtsSynthesisResult,
  TtsVoice,
} from "../types";
import { SUPERTONIC_VOICES } from "../voices/supertonic";
import { SUPERTONIC_LANGUAGES } from "../languages";

// Supertonic ships raw ONNX sessions + JSON config/voice tensors, NOT a
// Transformers.js model card. This engine drives onnxruntime-web directly,
// mirroring the official web demo's TextToSpeech.call(text, lang, style,
// totalStep, speed, silence, cb) shape. See:
//   https://github.com/supertone-inc/supertonic/blob/main/web/helper.js

const MODEL_REPO = "Supertone/supertonic-3";
const CDN = `https://huggingface.co/${MODEL_REPO}/resolve/main`;
const ONNX_DIR = `${CDN}/onnx`;

export const ONNX_PATHS = {
  config: `${ONNX_DIR}/tts.json`,
  indexer: `${ONNX_DIR}/unicode_indexer.json`,
  durationPredictor: `${ONNX_DIR}/duration_predictor.onnx`,
  textEncoder: `${ONNX_DIR}/text_encoder.onnx`,
  vectorEstimator: `${ONNX_DIR}/vector_estimator.onnx`,
  vocoder: `${ONNX_DIR}/vocoder.onnx`,
} as const;

// ponytail: brand promise is "Free (Faster)" — pin 5 denoising steps (demo
// default is 8). Bump only if quality complaints outweigh the speed win.
export const SUPERTONIC_TOTAL_STEPS = 5;

export function voiceUrl(voiceId: string): string {
  return `${CDN}/voice_styles/${voiceId}.json`;
}

// --- minimal ort surface (loose typing avoids fighting onnxruntime-web's
// bundled declarations; skipLibCheck covers the rest) ---

type OrtTensorData = Float32Array | BigInt64Array | number[];

interface OrtTensor {
  data: ArrayLike<number>;
  dims: readonly number[];
}
interface OrtTensorCtor {
  new (type: string, data: OrtTensorData, dims: number[]): OrtTensor;
}
interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
interface OrtSessionOptions {
  executionProviders?: string[];
  graphOptimizationLevel?: string;
}
interface OrtModule {
  Tensor: OrtTensorCtor;
  InferenceSession: {
    create(
      buffer: ArrayBuffer | Uint8Array,
      options?: OrtSessionOptions,
    ): Promise<OrtSession>;
  };
}

let ortPromise: Promise<OrtModule> | null = null;
function getOrt(): Promise<OrtModule> {
  // ponytail: lazy-load so importing this module (incl. in tests/SSR) never
  // pulls onnxruntime-web or its wasm assets.
  if (!ortPromise) {
    ortPromise = import("onnxruntime-web").then(
      (m) => m as unknown as OrtModule,
    );
  }
  return ortPromise;
}

interface SupertonicConfig {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`);
  return res.json() as Promise<T>;
}

// ponytail: stream the 4 big ONNX files so ensureLoaded(onProgress) reflects
// real bytes (vector_estimator alone is ~250MB). Falls back to a plain
// arrayBuffer() when the body is opaque or content-length is missing.
async function fetchArrayBufferWithProgress(
  url: string,
  onProgress?: (pct: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`);
  if (!res.body) return res.arrayBuffer();
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.length;
    if (total > 0 && onProgress) onProgress((received / total) * 100);
  }
  if (onProgress) onProgress(100);
  const merged = new Uint8Array(received);
  let pos = 0;
  for (const c of chunks) {
    merged.set(c, pos);
    pos += c.length;
  }
  return merged.buffer;
}

function flattenNum(data: unknown): number[] {
  return (data as number[]).flat(Infinity) as number[];
}

// --- text preprocessing (faithful port of demo UnicodeProcessor) ---

const AVAILABLE_LANGS = new Set([
  "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi",
  "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro",
  "ru", "sk", "sl", "sv", "tr", "uk", "vi", "na",
]);

class UnicodeProcessor {
  constructor(private indexer: number[]) {}

  call(textList: string[], langList: string[]) {
    const processed = textList.map((t, i) => this.preprocessText(t, langList[i]));
    const textIdsLengths = processed.map((t) => t.length);
    const maxLen = Math.max(...textIdsLengths);
    const textIds = processed.map((text) => {
      const row = new Array(maxLen).fill(0);
      for (let j = 0; j < text.length; j++) {
        const cp = text.codePointAt(j)!;
        row[j] = cp < this.indexer.length ? this.indexer[cp] : -1;
      }
      return row;
    });
    return { textIds, textMask: this.getTextMask(textIdsLengths) };
  }

  private preprocessText(text: string, lang: string): string {
    text = text.normalize("NFKD");
    text = text.replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu,
      "",
    );
    const replacements: Record<string, string> = {
      "–": "-", "‑": "-", "—": "-", "_": " ",
      "\u201C": '"', "\u201D": '"', "\u2018": "'", "\u2019": "'",
      "´": "'", "`": "'", "[": " ", "]": " ", "|": " ", "/": " ",
      "#": " ", "→": " ", "←": " ",
    };
    for (const [k, v] of Object.entries(replacements)) text = text.replaceAll(k, v);
    text = text.replace(/[♥☆♡©\\]/g, "");
    const expr: Record<string, string> = {
      "@": " at ", "e.g.,": "for example, ", "i.e.,": "that is, ",
    };
    for (const [k, v] of Object.entries(expr)) text = text.replaceAll(k, v);
    text = text.replace(/ ([,.!;:'])/g, "$1");
    while (text.includes('""')) text = text.replace('""', '"');
    while (text.includes("''")) text = text.replace("''", "'");
    while (text.includes("``")) text = text.replace("``", "`");
    text = text.replace(/\s+/g, " ").trim();
    if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(text)) text += ".";
    if (!AVAILABLE_LANGS.has(lang)) {
      throw new Error(`Invalid language: ${lang}`);
    }
    return `<${lang}>${text}</${lang}>`;
  }

  private getTextMask(lengths: number[]): number[][][] {
    return this.lengthToMask(lengths);
  }

  private lengthToMask(lengths: number[], maxLen?: number): number[][][] {
    const actualMax = maxLen ?? Math.max(...lengths);
    return lengths.map((len) => {
      const row = new Array(actualMax).fill(0.0);
      for (let j = 0; j < Math.min(len, actualMax); j++) row[j] = 1.0;
      return [row];
    });
  }
}

class Style {
  constructor(public ttl: OrtTensor, public dp: OrtTensor) {}
}

// ponytail: demo's internal paragraph/sentence chunker. Kept verbatim because
// the model expects chunks ≤300 chars (120 for ko/ja); our chunk.ts feeds
// ≤500, so this re-splits before inference.
function chunkForInference(text: string, maxLen = 300): string[] {
  const paragraphs = text.trim().split(/\n\s*\n+/).filter((p) => p.trim());
  const chunks: string[] = [];
  for (let paragraph of paragraphs) {
    paragraph = paragraph.trim();
    if (!paragraph) continue;
    const sentences = paragraph.split(
      /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/,
    );
    let current = "";
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 <= maxLen) {
        current += (current ? " " : "") + sentence;
      } else {
        if (current) chunks.push(current.trim());
        current = sentence;
      }
    }
    if (current) chunks.push(current.trim());
  }
  return chunks;
}

type Latent3D = number[][][];

export class SupertonicTts {
  readonly sampleRate: number;

  constructor(
    private ort: OrtModule,
    private cfgs: SupertonicConfig,
    private textProcessor: UnicodeProcessor,
    private sessions: {
      durationPredictor: OrtSession;
      textEncoder: OrtSession;
      vectorEstimator: OrtSession;
      vocoder: OrtSession;
    },
  ) {
    this.sampleRate = cfgs.ae.sample_rate;
  }

  // Mirrors the demo's TextToSpeech.call signature exactly.
  async call(
    text: string,
    lang: string,
    style: Style,
    totalStep: number,
    speed = 1.05,
    silenceDuration = 0.3,
    progressCallback: ((step: number, total: number) => void) | null = null,
  ): Promise<{ wav: number[]; duration: number[] }> {
    if (style.ttl.dims[0] !== 1) {
      throw new Error("Single speaker text to speech only supports single style");
    }
    const maxLen = lang === "ko" || lang === "ja" ? 120 : 300;
    const textList = chunkForInference(text, maxLen);
    let wavCat: number[] = [];
    let durCat = 0;
    for (let i = 0; i < textList.length; i++) {
      const { wav, duration } = await this._infer(
        [textList[i]],
        [lang],
        style,
        totalStep,
        speed,
        progressCallback,
      );
      if (wavCat.length === 0) {
        wavCat = wav;
        durCat = duration[0];
      } else {
        const silenceLen = Math.floor(silenceDuration * this.sampleRate);
        const silence = new Array(silenceLen).fill(0);
        wavCat = [...wavCat, ...silence, ...wav];
        durCat += duration[0] + silenceDuration;
      }
    }
    return { wav: wavCat, duration: [durCat] };
  }

  private async _infer(
    textList: string[],
    langList: string[],
    style: Style,
    totalStep: number,
    speed: number,
    progressCallback: ((step: number, total: number) => void) | null,
  ): Promise<{ wav: number[]; duration: number[] }> {
    const ort = this.ort;
    const bsz = textList.length;
    const { textIds, textMask } = this.textProcessor.call(textList, langList);

    const textIdsTensor = new ort.Tensor(
      "int64",
      new BigInt64Array(textIds.flat().map((x) => BigInt(x))),
      [bsz, textIds[0].length],
    );
    const textMaskTensor = new ort.Tensor(
      "float32",
      new Float32Array(textMask.flat(2)),
      [bsz, 1, textMask[0][0].length],
    );

    const dpOutputs = await this.sessions.durationPredictor.run({
      text_ids: textIdsTensor,
      style_dp: style.dp,
      text_mask: textMaskTensor,
    });
    const duration = Array.from(dpOutputs.duration.data);
    for (let i = 0; i < duration.length; i++) duration[i] /= speed;

    const textEncOutputs = await this.sessions.textEncoder.run({
      text_ids: textIdsTensor,
      style_ttl: style.ttl,
      text_mask: textMaskTensor,
    });
    const textEmb = textEncOutputs.text_emb;

    const { xt, latentMask } = this.sampleNoisyLatent(
      duration,
      this.sampleRate,
      this.cfgs.ae.base_chunk_size,
      this.cfgs.ttl.chunk_compress_factor,
      this.cfgs.ttl.latent_dim,
    );
    const latentMaskTensor = new ort.Tensor(
      "float32",
      new Float32Array(latentMask.flat(2)),
      [bsz, 1, latentMask[0][0].length],
    );

    const totalStepTensor = new ort.Tensor(
      "float32",
      new Float32Array(bsz).fill(totalStep),
      [bsz],
    );

    let cur = xt;
    for (let step = 0; step < totalStep; step++) {
      if (progressCallback) progressCallback(step + 1, totalStep);
      const currentStepTensor = new ort.Tensor(
        "float32",
        new Float32Array(bsz).fill(step),
        [bsz],
      );
      const xtTensor = new ort.Tensor(
        "float32",
        new Float32Array(cur.flat(2)),
        [bsz, cur[0].length, cur[0][0].length],
      );
      const estOutputs = await this.sessions.vectorEstimator.run({
        noisy_latent: xtTensor,
        text_emb: textEmb,
        style_ttl: style.ttl,
        latent_mask: latentMaskTensor,
        text_mask: textMaskTensor,
        current_step: currentStepTensor,
        total_step: totalStepTensor,
      });
      const denoised = Array.from(estOutputs.denoised_latent.data);
      const latentDim = cur[0].length;
      const latentLen = cur[0][0].length;
      const next: Latent3D = [];
      let idx = 0;
      for (let b = 0; b < bsz; b++) {
        const batch: number[][] = [];
        for (let d = 0; d < latentDim; d++) {
          const row: number[] = [];
          for (let t = 0; t < latentLen; t++) row.push(denoised[idx++]);
          batch.push(row);
        }
        next.push(batch);
      }
      cur = next;
    }

    const finalTensor = new ort.Tensor(
      "float32",
      new Float32Array(cur.flat(2)),
      [bsz, cur[0].length, cur[0][0].length],
    );
    const vocoderOutputs = await this.sessions.vocoder.run({ latent: finalTensor });
    return { wav: Array.from(vocoderOutputs.wav_tts.data), duration };
  }

  private sampleNoisyLatent(
    duration: number[],
    sampleRate: number,
    baseChunkSize: number,
    chunkCompress: number,
    latentDim: number,
  ): { xt: Latent3D; latentMask: number[][][] } {
    const bsz = duration.length;
    const maxDur = Math.max(...duration);
    const wavLenMax = Math.floor(maxDur * sampleRate);
    const chunkSize = baseChunkSize * chunkCompress;
    const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
    const latentDimVal = latentDim * chunkCompress;

    const xt: Latent3D = [];
    for (let b = 0; b < bsz; b++) {
      const batch: number[][] = [];
      for (let d = 0; d < latentDimVal; d++) {
        const row: number[] = [];
        for (let t = 0; t < latentLen; t++) {
          const u1 = Math.max(0.0001, Math.random());
          const u2 = Math.random();
          row.push(
            Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2),
          );
        }
        batch.push(row);
      }
      xt.push(batch);
    }

    const wavLengths = duration.map((d) => Math.floor(d * sampleRate));
    const latentLengths = wavLengths.map((len) =>
      Math.floor((len + chunkSize - 1) / chunkSize),
    );
    const latentMask = this.lengthToMask(latentLengths, latentLen);
    for (let b = 0; b < bsz; b++) {
      for (let d = 0; d < latentDimVal; d++) {
        for (let t = 0; t < latentLen; t++) {
          xt[b][d][t] *= latentMask[b][0][t];
        }
      }
    }
    return { xt, latentMask };
  }

  private lengthToMask(lengths: number[], maxLen?: number): number[][][] {
    const actualMax = maxLen ?? Math.max(...lengths);
    return lengths.map((len) => {
      const row = new Array(actualMax).fill(0.0);
      for (let j = 0; j < Math.min(len, actualMax); j++) row[j] = 1.0;
      return [row];
    });
  }
}

interface VoiceStyleJson {
  style_ttl: { data: unknown; dims: number[] };
  style_dp: { data: unknown; dims: number[] };
}

async function loadVoiceStyle(paths: string[]): Promise<Style> {
  const ort = await getOrt();
  const bsz = paths.length;
  const first = await fetchJson<VoiceStyleJson>(paths[0]);
  const [, ttlDim1, ttlDim2] = first.style_ttl.dims;
  const [, dpDim1, dpDim2] = first.style_dp.dims;

  const ttlFlat = new Float32Array(bsz * ttlDim1 * ttlDim2);
  const dpFlat = new Float32Array(bsz * dpDim1 * dpDim2);
  for (let i = 0; i < bsz; i++) {
    const vs = i === 0 ? first : await fetchJson<VoiceStyleJson>(paths[i]);
    ttlFlat.set(flattenNum(vs.style_ttl.data), i * ttlDim1 * ttlDim2);
    dpFlat.set(flattenNum(vs.style_dp.data), i * dpDim1 * dpDim2);
  }
  return new Style(
    new ort.Tensor("float32", ttlFlat, [bsz, ttlDim1, ttlDim2]),
    new ort.Tensor("float32", dpFlat, [bsz, dpDim1, dpDim2]),
  );
}

async function createSession(
  ort: OrtModule,
  buffer: ArrayBuffer,
): Promise<OrtSession> {
  // ponytail: demo tries WebGPU then falls back to WASM. Reuse one fetched
  // buffer for both attempts.
  try {
    return await ort.InferenceSession.create(buffer, {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
    });
  } catch {
    return await ort.InferenceSession.create(buffer, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  }
}

interface LoadedModel {
  tts: SupertonicTts;
  cfgs: SupertonicConfig;
}

async function loadSupertonic(
  onProgress?: (pct: number) => void,
): Promise<LoadedModel> {
  const ort = await getOrt();
  const cfgs = await fetchJson<SupertonicConfig>(ONNX_PATHS.config);
  const indexer = await fetchJson<number[]>(ONNX_PATHS.indexer);
  const textProcessor = new UnicodeProcessor(indexer);

  const modelFiles: Array<["dp" | "te" | "ve" | "vo", string]> = [
    ["dp", ONNX_PATHS.durationPredictor],
    ["te", ONNX_PATHS.textEncoder],
    ["ve", ONNX_PATHS.vectorEstimator],
    ["vo", ONNX_PATHS.vocoder],
  ];

  // ponytail: the four ONNX files are the bulk of the download (~400MB). Map
  // per-file byte progress into the overall 0–100 range so callers see real
  // movement instead of a 25% step per file.
  const sessions: Record<string, OrtSession> = {};
  for (let i = 0; i < modelFiles.length; i++) {
    const [key, url] = modelFiles[i];
    const sliceStart = (i / modelFiles.length) * 100;
    const sliceEnd = ((i + 1) / modelFiles.length) * 100;
    const buffer = await fetchArrayBufferWithProgress(url, (filePct) => {
      if (onProgress)
        onProgress(sliceStart + ((filePct / 100) * (sliceEnd - sliceStart)));
    });
    sessions[key] = await createSession(ort, buffer);
  }
  if (onProgress) onProgress(100);

  const tts = new SupertonicTts(ort, cfgs, textProcessor, {
    durationPredictor: sessions.dp,
    textEncoder: sessions.te,
    vectorEstimator: sessions.ve,
    vocoder: sessions.vo,
  });
  return { tts, cfgs };
}

function wavToAudioBuffer(wav: number[], sampleRate: number): AudioBuffer {
  const ctx = new AudioContext({ sampleRate });
  const buffer = ctx.createBuffer(1, wav.length, sampleRate);
  buffer.getChannelData(0).set(new Float32Array(wav));
  return buffer;
}

export const supertonicEngine: TtsEngine = (() => {
  let loadPromise: Promise<LoadedModel> | null = null;
  const styleCache = new Map<string, Style>();

  function load(onProgress?: (pct: number) => void): Promise<LoadedModel> {
    if (!loadPromise) loadPromise = loadSupertonic(onProgress);
    return loadPromise;
  }

  async function getStyle(voiceId: string): Promise<Style> {
    const cached = styleCache.get(voiceId);
    if (cached) return cached;
    const style = await loadVoiceStyle([voiceUrl(voiceId)]);
    styleCache.set(voiceId, style);
    return style;
  }

  return {
    id: "supertonic",
    label: "Free (Faster)",
    getVoices: (): TtsVoice[] =>
      SUPERTONIC_VOICES.map((v) => ({
        id: v.id,
        label: v.label,
        gender: v.gender,
      })),
    supportsLanguage: (lang: string) => SUPERTONIC_LANGUAGES.has(lang),
    ensureLoaded(onProgress) {
      return load(onProgress).then(() => undefined);
    },
    async synthesize(
      text: string,
      opts: SynthesizeOpts,
    ): Promise<TtsSynthesisResult> {
      const { tts } = await load();
      const style = await getStyle(opts.voiceId);
      const speed = opts.speed ?? 1.05;
      const { wav, duration } = await tts.call(
        text,
        opts.lang,
        style,
        SUPERTONIC_TOTAL_STEPS,
        speed,
        0.3,
        null,
      );
      const wavLen = Math.floor(tts.sampleRate * duration[0]);
      const buffer = wavToAudioBuffer(wav.slice(0, wavLen), tts.sampleRate);
      return { kind: "audioBuffer", buffer };
    },
    dispose() {
      loadPromise = null;
      styleCache.clear();
    },
  };
})();
