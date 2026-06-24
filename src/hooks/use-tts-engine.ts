"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { EpubViewerHandle } from "@/components/reader/epub-viewer";
import { chunkText, CHUNK_LIMITS } from "@/lib/tts/chunk";
import { getEngine } from "@/lib/tts/engines";
import { getSpeechSynthesis } from "@/lib/tts/engines/browser-speech-engine";
import type { EngineId } from "@/lib/tts/languages";
import type { TtsEngine, TtsSynthesisResult } from "@/lib/tts/types";
import {
  FALLBACK_WPM,
  countWords,
  deriveWpm,
  estimateSeconds,
  getCachedWpm,
  setCachedWpm,
} from "@/lib/tts/estimate";

// ponytail: once Kokoro fails in this session (phonemizer broken, no WebGPU,
// etc.), skip it on all subsequent attempts. Survives component remounts so
// navigating away and back doesn't re-trigger the multi-second timeout.
let kokoroKnownBroken = false;

// Exposed for test reset only.
export function _resetKokoroKnownBroken() {
  kokoroKnownBroken = false;
}

export interface TtsEngineState {
  phase: "IDLE" | "LOADING" | "PLAYING" | "PAUSED" | "ENDED";
  loadPct: number;
  sectionTitle: string;
  sectionHref: string;
  // ponytail: elapsed/total seconds for the AudioBuffer path (Kokoro/Supertonic).
  // Both 0 for the speechSynthesis fallback, which can't expose position — the
  // player hides the readout in that case.
  currentTime: number;
  duration: number;
  error?: string;
}

export interface UseTtsEngineOptions {
  bookId: string;
  bookLanguage: string;
  /**
   * Text source for the section being synthesized. In the reader this should
   * read from the live iframe (and optionally navigate to the section first so
   * highlight-follow-along aligns); on the bookshelf or for playlist jumps it
   * falls back to the server-side section-text endpoint.
   */
  getText: (href: string) => Promise<string>;
  /** Optional live viewer, used only for follow-along highlighting. */
  viewerRef?: React.RefObject<EpubViewerHandle | null>;
  engineId: EngineId;
  voiceId: string;
  speed?: number;
  onSectionComplete?: () => void;
}

export interface UseTtsEngineReturn {
  state: TtsEngineState;
  /** Engine actually in use after any runtime fallback (e.g. WebGPU → browser). */
  effectiveEngineId: EngineId;
  startSection: (href: string, title: string) => void;
  pause: () => void;
  resume: () => void;
  close: () => void;
}

const emptyState: TtsEngineState = {
  phase: "IDLE",
  loadPct: 0,
  sectionTitle: "",
  sectionHref: "",
  currentTime: 0,
  duration: 0,
};

function isAudioBufferResult(
  result: TtsSynthesisResult,
): result is { kind: "audioBuffer"; buffer: AudioBuffer } {
  return result.kind === "audioBuffer";
}

function isBrowserEngine(engine: TtsEngine): boolean {
  return engine.id === "browser";
}

function pauseBrowserSpeech(): void {
  const s = getSpeechSynthesis();
  if (s) {
    try {
      s.pause();
    } catch {
      // ignore
    }
  }
}

function resumeBrowserSpeech(): void {
  const s = getSpeechSynthesis();
  if (s) {
    try {
      s.resume();
    } catch {
      // ignore
    }
  }
}

function cancelBrowserSpeech(): void {
  const s = getSpeechSynthesis();
  if (s) {
    try {
      s.cancel();
    } catch {
      // ignore
    }
  }
}

export function useTtsEngine(options: UseTtsEngineOptions): UseTtsEngineReturn {
  const {
    bookLanguage,
    getText,
    viewerRef,
    engineId,
    voiceId,
    speed = 1,
    onSectionComplete,
  } = options;

  const [state, setState] = useState<TtsEngineState>(emptyState);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const chunksRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
  const runningRef = useRef(false);
  const abortRef = useRef(false);
  const engineRef = useRef<TtsEngine | null>(null);
  // ponytail: 1-chunk prefetch cache for audio-buffer engines. Stores promises
  // so both in-flight and resolved syntheses share the same await path.
  const bufferCacheRef = useRef<Map<number, Promise<AudioBuffer>>>(new Map());
  // ponytail: engineIdRef tracks the effective id (prop or browser fallback).
  // Kept in a ref so callbacks stay stable and the fallback swap is read on
  // the next startSection without rebuilding the memo graph.
  const engineIdRef = useRef<EngineId>(engineId);

  // ponytail: per-chunk playback timing. AudioBuffer engines expose duration
  // per chunk (buffer.duration); we accumulate completed chunks into
  // elapsedBeforeRef and measure the in-flight chunk against AudioContext time.
  // Ceiling: the speechSynthesis fallback exposes none of this → duration stays 0
  // and the player hides the readout.
  const durationsRef = useRef<number[]>([]);
  const elapsedBeforeRef = useRef(0);
  const chunkStartedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ponytail: section-duration estimate bookkeeping. The synthesized-buffer
  // path only learns each chunk's true length as it resolves, so we seed the
  // displayed total from a per-voice WPM estimate and refine it proportionally
  // as real chunks land (converging to the exact total by the last chunk).
  // chunkWordCountsRef parallels durationsRef; totalWordsRef is the full
  // section word count; seedRef holds the pre-resolution fallback estimate.
  const chunkWordCountsRef = useRef<number[]>([]);
  const totalWordsRef = useRef(0);
  const seedRef = useRef(0);

  useEffect(() => {
    engineIdRef.current = engineId;
  }, [engineId]);

  // ponytail: effectiveEngineId mirrors engineIdRef but as state, so consumers
  // (voice picker) re-render when a WebGPU fallback swaps us to "browser".
  // Render-time prop-change guard resets it alongside the ref without a
  // setState-in-effect (idiomatic "adjusting state when a prop changes").
  const [effectiveEngineId, setEffectiveEngineId] = useState<EngineId>(engineId);
  const [prevEngineId, setPrevEngineId] = useState<EngineId>(engineId);
  if (engineId !== prevEngineId) {
    setPrevEngineId(engineId);
    setEffectiveEngineId(engineId);
  }

  // ponytail: proportional section-duration estimate. Sums the durations +
  // word counts of every resolved chunk, then scales known-duration up by the
  // (totalWords / knownWords) ratio → an actual-speed total that converges to
  // exact as chunks resolve. Falls back to the WPM seed before any chunk lands.
  const computeDuration = useCallback(() => {
    const durs = durationsRef.current;
    const words = chunkWordCountsRef.current;
    let knownDur = 0;
    let knownWords = 0;
    for (let i = 0; i < durs.length; i++) {
      const d = durs[i];
      if (typeof d === "number" && d > 0) {
        knownDur += d;
        knownWords += words[i] ?? 0;
      }
    }
    const total = totalWordsRef.current;
    if (knownWords > 0 && total > 0) return knownDur * (total / knownWords);
    return seedRef.current;
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ponytail: ~4Hz is enough for a mm:ss readout without thrashing React.
  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => {
      const ctx = audioContextRef.current;
      const startedAt = chunkStartedAtRef.current;
      if (ctx == null || startedAt == null) return;
      const idx = currentIndexRef.current;
      const cur = durationsRef.current[idx] ?? 0;
      const within = Math.max(0, Math.min(cur, ctx.currentTime - startedAt));
      setState((s) => ({ ...s, currentTime: elapsedBeforeRef.current + within }));
    }, 250);
  }, [stopTimer]);

  const recordDuration = useCallback(
    (index: number, duration: number) => {
      durationsRef.current[index] = duration;
      // ponytail: cache this voice's baseline (speed=1) WPM from the first
      // resolved chunk so future sections seed accurately. Engines bake `speed`
      // into the buffer, so normalize by the current speed to recover the 1x
      // rate the seed formula expects.
      const cw = chunkWordCountsRef.current[index] ?? 0;
      if (cw > 0 && duration > 0 && speed > 0) {
        const baseline = deriveWpm(cw, duration) / speed;
        if (baseline > 0) setCachedWpm(engineIdRef.current, voiceId, baseline);
      }
      setState((s) => ({ ...s, duration: computeDuration() }));
    },
    [computeDuration, speed, voiceId],
  );

  const cleanupSource = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop();
      } catch {
        // already stopped or not started
      }
      sourceNodeRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    runningRef.current = false;
    abortRef.current = true;
    cleanupSource();
    stopTimer();
    cancelBrowserSpeech();
    viewerRef?.current?.clearTtsHighlight();
    bufferCacheRef.current.clear();
    if (audioContextRef.current?.state !== "closed") {
      try {
        void audioContextRef.current?.close();
      } catch {
        // ignore
      }
    }
    audioContextRef.current = null;
    chunksRef.current = [];
    currentIndexRef.current = 0;
    durationsRef.current = [];
    chunkWordCountsRef.current = [];
    totalWordsRef.current = 0;
    seedRef.current = 0;
    elapsedBeforeRef.current = 0;
    chunkStartedAtRef.current = null;
    setState(emptyState);
  }, [cleanupSource, stopTimer, viewerRef]);

  const synthesizeCached = useCallback(
    (engine: TtsEngine, index: number): Promise<AudioBuffer> => {
      const cached = bufferCacheRef.current.get(index);
      if (cached) return cached;

      const SYNTHESIS_TIMEOUT_MS = 15_000;
      const promise = (async () => {
        const result = await Promise.race([
          engine.synthesize(chunksRef.current[index], {
            voiceId,
            lang: bookLanguage,
            speed,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Synthesis timed out after ${SYNTHESIS_TIMEOUT_MS / 1000}s`,
                  ),
                ),
              SYNTHESIS_TIMEOUT_MS,
            ),
          ),
        ]);

        if (!isAudioBufferResult(result)) {
          throw new Error(
            `Engine "${engine.id}" returned unsupported result kind: ${result.kind}`,
          );
        }
        // ponytail: record the chunk's duration so the readout total converges
        // as buffers resolve (prefetch is one chunk ahead).
        recordDuration(index, result.buffer.duration);
        return result.buffer;
      })();

      bufferCacheRef.current.set(index, promise);
      return promise;
    },
    [bookLanguage, recordDuration, speed, voiceId],
  );

  const playChunk = useCallback(
    async (engine: TtsEngine, index: number) => {
      if (!runningRef.current || abortRef.current) return;
      if (index >= chunksRef.current.length) {
        stopTimer();
        chunkStartedAtRef.current = null;
        setState((s) => ({ ...s, phase: "ENDED", currentTime: s.duration }));
        onSectionComplete?.();
        return;
      }

      currentIndexRef.current = index;
      setState((s) => ({ ...s, phase: "PLAYING" }));

      // ponytail: follow-along highlight — clear previous chunk's highlight,
      // then highlight the current chunk's text in the reader iframe. If the
      // text is on a later page, highlightChunk advances pages automatically.
      viewerRef?.current?.clearTtsHighlight();
      await viewerRef?.current?.highlightChunk(chunksRef.current[index]);

      try {
        // ponytail: browser speechSynthesis manages its own audio queue and
        // cannot return an AudioBuffer — synthesize resolves on `onend`, so
        // we just chain to the next chunk. No AudioBufferSourceNode needed.
        if (isBrowserEngine(engine)) {
          const SYNTHESIS_TIMEOUT_MS = 15_000;
          const result = await Promise.race([
            engine.synthesize(chunksRef.current[index], {
              voiceId,
              lang: bookLanguage,
              speed,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Synthesis timed out after ${SYNTHESIS_TIMEOUT_MS / 1000}s`,
                    ),
                  ),
                SYNTHESIS_TIMEOUT_MS,
              ),
            ),
          ]);

          if (!runningRef.current || abortRef.current) return;

          if (!isAudioBufferResult(result)) {
            void playChunk(engine, index + 1);
            return;
          }

          throw new Error(
            `Browser engine "${engine.id}" returned unsupported audio buffer result`,
          );
        }

        const buffer = await synthesizeCached(engine, index);
        if (!runningRef.current || abortRef.current) return;

        const ctx = audioContextRef.current;
        if (!ctx) return;

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        sourceNodeRef.current = source;

        source.onended = () => {
          if (!runningRef.current || abortRef.current) return;
          sourceNodeRef.current = null;
          // ponytail: bank this chunk's duration into elapsed before advancing
          // so the readout keeps climbing across chunk boundaries.
          elapsedBeforeRef.current += durationsRef.current[index] ?? buffer.duration;
          // ponytail: free the just-played buffer now that it's consumed.
          bufferCacheRef.current.delete(index);
          void playChunk(engine, index + 1);
        };

        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        // ponytail: seed elapsed (completed-chunk total) + start the wall-clock
        // for this chunk, then tick currentTime ~4Hz for the readout/scrubber.
        chunkStartedAtRef.current = ctx.currentTime;
        source.start();
        setState((s) => ({ ...s, currentTime: elapsedBeforeRef.current }));
        startTimer();

        // ponytail: prefetch one chunk ahead — fire-and-forget. By the time
        // this chunk finishes playing, the next buffer is ready → no gap.
        if (index + 1 < chunksRef.current.length) {
          void synthesizeCached(engine, index + 1);
        }
      } catch (err) {
        if (abortRef.current) return;

        // ponytail: if the engine fails mid-synthesis (e.g. Kokoro's phonemizer
        // breaks), fall back to browser speech for the rest of the session —
        // same pattern as resolveEngine's load-time fallback.
        if (engineIdRef.current !== "browser") {
          console.warn("[TTS] Synthesis failed, falling back to browser:", err);
          toast("Switching to built-in voice");
          engineIdRef.current = "browser";
          setEffectiveEngineId("browser");
          // ponytail: discard any buffers/prefetches from the broken engine.
          bufferCacheRef.current.clear();
          try {
            const fallback = await getEngine("browser");
            await fallback.ensureLoaded();
            engineRef.current = fallback;
            await playChunk(fallback, index);
            return;
          } catch (fallbackErr) {
            console.error("[TTS] Browser fallback also failed:", fallbackErr);
          }
        }

        // ponytail: clear the failed chunk so a retry can resynthesize.
        bufferCacheRef.current.delete(index);

        console.error("[TTS] Synthesis failed:", err);
        setState((s) => ({
          ...s,
          phase: "IDLE",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [
      bookLanguage,
      onSectionComplete,
      speed,
      startTimer,
      stopTimer,
      synthesizeCached,
      voiceId,
      viewerRef,
    ],
  );

  // ponytail: try the requested engine; if its model load fails (no WebGPU,
  // OOM, network, broken phonemizer), fall back to the zero-download browser
  // engine and toast. kokoroKnownBroken caches the failure at module level so
  // subsequent attempts skip the multi-second wait.
  const resolveEngine = useCallback(async (): Promise<TtsEngine> => {
    const requestedId =
      kokoroKnownBroken && engineIdRef.current === "kokoro"
        ? "browser"
        : engineIdRef.current;
    if (requestedId !== engineIdRef.current) {
      console.log("[TTS] Skipping kokoro (known broken in this session)");
      engineIdRef.current = requestedId;
      setEffectiveEngineId(requestedId);
    }
    try {
      const engine = await getEngine(requestedId);
      console.log("[TTS] Loading engine:", engine.id);
      await engine.ensureLoaded((pct) => {
        setState((s) => ({ ...s, loadPct: pct }));
      });
      console.log("[TTS] Engine loaded successfully:", engine.id);
      engineRef.current = engine;
      return engine;
    } catch (primaryErr) {
      console.warn("[TTS] Engine load failed, falling back:", primaryErr);
      if (requestedId === "kokoro") kokoroKnownBroken = true;
      if (engineIdRef.current === "browser") throw primaryErr;
      toast("Switching to built-in voice");
      engineIdRef.current = "browser";
      setEffectiveEngineId("browser");
      const fallback = await getEngine("browser");
      await fallback.ensureLoaded();
      console.log("[TTS] Fallback engine loaded:", fallback.id);
      engineRef.current = fallback;
      return fallback;
    }
  }, []);

  const startSection = useCallback(
    async (href: string, title: string) => {
      abortRef.current = false;
      runningRef.current = true;
      cleanupSource();
      stopTimer();
      cancelBrowserSpeech();
      durationsRef.current = [];
      chunkWordCountsRef.current = [];
      totalWordsRef.current = 0;
      seedRef.current = 0;
      elapsedBeforeRef.current = 0;
      chunkStartedAtRef.current = null;

      // ponytail: create AudioContext synchronously within the user gesture,
      // before any await. Browsers gate AudioContext creation/resumption on a
      // user gesture; if we defer it past the async Kokoro-load chain, Safari
      // and Chrome will refuse to start playback.
      if (!audioContextRef.current) {
        try {
          audioContextRef.current = new AudioContext();
        } catch {
          // ponytail: AudioContext unavailable (SSR / very old browser) — browser
          // speech path doesn't need it, so this is non-fatal.
        }
      }

      setState({
        phase: "LOADING",
        loadPct: 0,
        sectionTitle: title,
        sectionHref: href,
        currentTime: 0,
        duration: 0,
      });

      try {
      // ponytail: read text from the injected source. In the reader this is the
      // live iframe; on the bookshelf or for playlist jumps it's the server-side
      // section-text endpoint. We deliberately do NOT await navigateTo here —
      // the text source handles any required navigation so the hook stays
      // decoupled from the viewer lifecycle.
      const text = await getText(href);
      console.log("[TTS] getText returned", text.length, "chars");
        if (!text.trim()) {
          console.warn("[TTS] Section text is empty, skipping");
          setState((s) => ({ ...s, phase: "ENDED" }));
          onSectionComplete?.();
          return;
        }

        console.log("[TTS] Resolving engine:", engineIdRef.current);
        const engine = await resolveEngine();
        console.log("[TTS] Engine resolved:", engine.id);

        if (!runningRef.current || abortRef.current) return;

        const limits = CHUNK_LIMITS[engineIdRef.current];
        if (!limits) {
          throw new Error(`No chunk limits for engine "${engineIdRef.current}"`);
        }

        chunksRef.current = chunkText(text, limits);
        currentIndexRef.current = 0;
        console.log("[TTS] Chunked into", chunksRef.current.length, "pieces, starting playback");

        // ponytail: seed the section-duration estimate from a per-voice WPM rate
        // (cached from a prior section's first chunk, else a generic fallback).
        // recordDuration refines this proportionally as real chunks resolve.
        chunkWordCountsRef.current = chunksRef.current.map(countWords);
        totalWordsRef.current = chunkWordCountsRef.current.reduce(
          (acc, n) => acc + n,
          0,
        );
        const cachedWpm =
          getCachedWpm(engineIdRef.current, voiceId) ?? FALLBACK_WPM;
        seedRef.current = estimateSeconds(totalWordsRef.current, cachedWpm, speed);
        setState((s) => ({ ...s, duration: seedRef.current }));

        await playChunk(engine, 0);
      } catch (err) {
        if (!abortRef.current) {
          console.error("[TTS] Failed to start section:", err);
          setState((s) => ({
            ...s,
            phase: "IDLE",
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }
    },
    [cleanupSource, getText, onSectionComplete, playChunk, resolveEngine, speed, stopTimer, voiceId],
  );

  const pause = useCallback(() => {
    if (state.phase !== "PLAYING") return;
    runningRef.current = false;
    if (engineRef.current && isBrowserEngine(engineRef.current)) {
      pauseBrowserSpeech();
    } else {
      // ponytail: DON'T stop the source — AudioBufferSourceNode is one-shot, so
      // stopping it would force a restart-from-zero on resume ("starts over").
      // Suspending the context freezes the in-flight buffer at its exact
      // position; resume() continues it sample-accurately. Keep sourceNodeRef
      // and chunkStartedAtRef intact for the timer to pick back up.
      stopTimer();
      audioContextRef.current?.suspend();
    }
    setState((s) => ({ ...s, phase: "PAUSED" }));
  }, [stopTimer, state.phase]);

  const resume = useCallback(() => {
    if (state.phase !== "PAUSED") return;
    runningRef.current = true;
    if (engineRef.current && isBrowserEngine(engineRef.current)) {
      // ponytail: speechSynthesis.resume() restarts the paused utterance
      // in place; no need to re-fire it through playChunk.
      resumeBrowserSpeech();
      setState((s) => ({ ...s, phase: "PLAYING" }));
    } else if (sourceNodeRef.current) {
      // ponytail: the frozen source is still alive — resume the context within
      // the click gesture and it continues exactly where it paused.
      audioContextRef.current?.resume();
      startTimer();
      setState((s) => ({ ...s, phase: "PLAYING" }));
    } else {
      // ponytail: paused during a between-chunk gap (next chunk never started).
      // Nothing is frozen to continue, so replay the current chunk from its
      // start — nothing audible is lost.
      audioContextRef.current?.resume();
      setState((s) => ({ ...s, phase: "LOADING" }));
      void getEngine(engineIdRef.current).then((engine) =>
        playChunk(engine, currentIndexRef.current),
      );
    }
  }, [playChunk, startTimer, state.phase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
      cleanupSource();
      stopTimer();
      cancelBrowserSpeech();
      if (audioContextRef.current?.state !== "closed") {
        try {
          void audioContextRef.current?.close();
        } catch {
          // ignore
        }
      }
    };
  }, [cleanupSource, stopTimer]);

  return { state, effectiveEngineId, startSection, pause, resume, close };
}
