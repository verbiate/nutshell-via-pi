// ponytail: section-duration estimation for the AudioBuffer TTS path. The
// synthesized-buffer path only learns each chunk's true length as it resolves,
// so a naive "total" climbs chunk-by-chunk. Instead we seed an estimate from a
// per-voice words-per-minute rate and refine it proportionally as real chunks
// land (converging to the exact total by the last chunk). The per-voice WPM is
// measured once from the first real chunk and cached so later sections seed
// accurately without re-measuring.

// ponytail: baseline used before a voice has been calibrated. Natural neural
// TTS voices land ~150–180 WPM at 1.0x; 170 is a safe middle. Replaced by the
// measured rate after chunk 0 of any section resolves.
export const FALLBACK_WPM = 170;

const STORAGE_KEY = "nutshell:tts-wpm";

// ponytail: in-session cache mirrors localStorage so reads are sync and we
// survive a round-trip-free second section. Keyed by `${engineId}:${voiceId}`.
const sessionCache = new Map<string, number>();

function readStore(): Record<string, number> {
  if (typeof globalThis.localStorage === "undefined") return {};
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    // ponytail: corrupt/unavailable storage — fall back to session cache only.
    return {};
  }
}

function writeStore(data: Record<string, number>): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ponytail: quota/private mode — non-blocking; session cache still works.
  }
}

export function cacheKey(engineId: string, voiceId: string): string {
  return `${engineId}:${voiceId}`;
}

export function getCachedWpm(engineId: string, voiceId: string): number | null {
  const key = cacheKey(engineId, voiceId);
  const hit = sessionCache.get(key);
  if (hit != null) return hit;
  const stored = readStore()[key];
  if (typeof stored === "number" && stored > 0) {
    sessionCache.set(key, stored);
    return stored;
  }
  return null;
}

export function setCachedWpm(engineId: string, voiceId: string, wpm: number): void {
  if (!(wpm > 0) || !isFinite(wpm)) return;
  const key = cacheKey(engineId, voiceId);
  sessionCache.set(key, wpm);
  const data = readStore();
  data[key] = wpm;
  writeStore(data);
}

// ponytail: test-only reset of the in-session + persisted WPM cache. Mirrors
// the _resetKokoroKnownBroken pattern in use-tts-engine.
export function _resetWpmCache(): void {
  sessionCache.clear();
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

// ponytail: estimated playback seconds for `totalWords` at a given voice rate
// and speed multiplier. Engines bake `speed` into the synthesized audio, so the
// effective rate scales linearly: duration ∝ 1/speed.
export function estimateSeconds(totalWords: number, wpm: number, speed: number): number {
  const effectiveWpm = Math.max(1, wpm) * Math.max(0.1, speed);
  return (totalWords / effectiveWpm) * 60;
}

// ponytail: derive a voice's true WPM from one measured chunk. `words` covers
// exactly the span of `durationSeconds` (the chunk's synthesized length at
// speed=1). Caller must pass a chunk synthesized without speed-scaling, OR pass
// the speed used so it can be normalized — we assume speed=1 calibration here.
export function deriveWpm(words: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return FALLBACK_WPM;
  return (words / durationSeconds) * 60;
}

// ponytail: opt-in self-check (TTS_ESTIMATE_DEMO=1).
function demo(): void {
  assert(countWords("one two three") === 3, "word count");
  assert(countWords("  leading\nspaces   ") === 2, "whitespace tolerance");
  assert(Math.abs(estimateSeconds(170, 170, 1) - 60) < 1e-6, "1 min @ 170wpm/1x");
  assert(Math.abs(estimateSeconds(340, 170, 2) - 60) < 1e-6, "speed halves duration");
  assert(Math.abs(deriveWpm(100, 40) - 150) < 1e-6, "100 words / 40s = 150wpm");
  console.log("[tts/estimate] self-check OK");
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[tts/estimate] self-check failed: ${msg}`);
}

if (process.env.TTS_ESTIMATE_DEMO) {
  demo();
}
