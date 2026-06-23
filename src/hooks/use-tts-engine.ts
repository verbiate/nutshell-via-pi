"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { EpubViewerHandle } from "@/components/reader/epub-viewer";
import { chunkText, CHUNK_LIMITS } from "@/lib/tts/chunk";
import { getEngine } from "@/lib/tts/engines";
import { getSpeechSynthesis } from "@/lib/tts/engines/browser-speech-engine";
import type { EngineId } from "@/lib/tts/languages";
import type { TtsEngine, TtsSynthesisResult } from "@/lib/tts/types";

export interface TtsEngineState {
  phase: "IDLE" | "LOADING" | "PLAYING" | "PAUSED" | "ENDED";
  loadPct: number;
  sectionTitle: string;
  sectionHref: string;
  error?: string;
}

export interface UseTtsEngineOptions {
  bookId: string;
  bookLanguage: string;
  viewerRef: React.RefObject<EpubViewerHandle | null>;
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
  // ponytail: engineIdRef tracks the effective id (prop or browser fallback).
  // Kept in a ref so callbacks stay stable and the fallback swap is read on
  // the next startSection without rebuilding the memo graph.
  const engineIdRef = useRef<EngineId>(engineId);

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
    cancelBrowserSpeech();
    viewerRef.current?.clearTtsHighlight();
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
    setState(emptyState);
  }, [cleanupSource, viewerRef]);

  const playChunk = useCallback(
    async (engine: TtsEngine, index: number) => {
      if (!runningRef.current || abortRef.current) return;
      if (index >= chunksRef.current.length) {
        setState((s) => ({ ...s, phase: "ENDED" }));
        onSectionComplete?.();
        return;
      }

      currentIndexRef.current = index;
      setState((s) => ({ ...s, phase: "PLAYING" }));

      // ponytail: follow-along highlight — clear previous chunk's highlight,
      // then highlight the current chunk's text in the reader iframe. If the
      // text is on a later page, highlightChunk advances pages automatically.
      viewerRef.current?.clearTtsHighlight();
      await viewerRef.current?.highlightChunk(chunksRef.current[index]);

      try {
        // ponytail: wrap synthesis in a timeout — if the engine hangs (e.g.
        // kokoro-js phonemizer deadlock), we don't block playback forever.
        const SYNTHESIS_TIMEOUT_MS = 15_000;
        const result = await Promise.race([
          engine.synthesize(chunksRef.current[index], {
            voiceId,
            lang: bookLanguage,
            speed,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Synthesis timed out after ${SYNTHESIS_TIMEOUT_MS / 1000}s`)),
              SYNTHESIS_TIMEOUT_MS,
            ),
          ),
        ]);

        if (!runningRef.current || abortRef.current) return;

        // ponytail: browser speechSynthesis manages its own audio queue and
        // cannot return an AudioBuffer — synthesize resolves on `onend`, so
        // we just chain to the next chunk. No AudioBufferSourceNode needed.
        if (!isAudioBufferResult(result)) {
          if (!isBrowserEngine(engine)) {
            throw new Error(
              `Engine "${engine.id}" returned unsupported result kind: ${result.kind}`,
            );
          }
          void playChunk(engine, index + 1);
          return;
        }

        const ctx = audioContextRef.current;
        if (!ctx) return;

        const source = ctx.createBufferSource();
        source.buffer = result.buffer;
        source.connect(ctx.destination);
        sourceNodeRef.current = source;

        source.onended = () => {
          if (!runningRef.current || abortRef.current) return;
          sourceNodeRef.current = null;
          void playChunk(engine, index + 1);
        };

        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        source.start();
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

        console.error("[TTS] Synthesis failed:", err);
        setState((s) => ({
          ...s,
          phase: "IDLE",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [bookLanguage, onSectionComplete, speed, voiceId, viewerRef],
  );

  // ponytail: try the requested engine; if its model load fails (no WebGPU,
  // OOM, network), fall back to the zero-download browser engine and toast.
  const resolveEngine = useCallback(async (): Promise<TtsEngine> => {
    try {
      const engine = await getEngine(engineIdRef.current);
      console.log("[TTS] Loading engine:", engine.id);
      await engine.ensureLoaded((pct) => {
        setState((s) => ({ ...s, loadPct: pct }));
      });
      console.log("[TTS] Engine loaded successfully:", engine.id);
      engineRef.current = engine;
      return engine;
    } catch (primaryErr) {
      console.warn("[TTS] Engine load failed, falling back:", primaryErr);
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
      cancelBrowserSpeech();

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
      });

      try {
        // ponytail: read text from the already-rendered iframe. We deliberately
        // do NOT await navigateTo here — the user is already on the section when
        // they click "Listen", and re-displaying the same href can cause epub.js
        // to reload the iframe, racing with getSectionText. Auto-advance callers
        // navigate the viewer via onSectionComplete before calling startSection.
        const text = viewerRef.current?.getSectionText() ?? "";
        console.log("[TTS] getSectionText returned", text.length, "chars");
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
    [cleanupSource, onSectionComplete, playChunk, resolveEngine, viewerRef],
  );

  const pause = useCallback(() => {
    if (state.phase !== "PLAYING") return;
    runningRef.current = false;
    if (engineRef.current && isBrowserEngine(engineRef.current)) {
      pauseBrowserSpeech();
    } else {
      cleanupSource();
      audioContextRef.current?.suspend();
    }
    setState((s) => ({ ...s, phase: "PAUSED" }));
  }, [cleanupSource, state.phase]);

  const resume = useCallback(() => {
    if (state.phase !== "PAUSED") return;
    runningRef.current = true;
    if (engineRef.current && isBrowserEngine(engineRef.current)) {
      // ponytail: speechSynthesis.resume() restarts the paused utterance
      // in place; no need to re-fire it through playChunk.
      resumeBrowserSpeech();
      setState((s) => ({ ...s, phase: "PLAYING" }));
    } else {
      setState((s) => ({ ...s, phase: "LOADING" }));
      void getEngine(engineIdRef.current).then((engine) =>
        playChunk(engine, currentIndexRef.current),
      );
    }
  }, [playChunk, state.phase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
      cleanupSource();
      cancelBrowserSpeech();
      if (audioContextRef.current?.state !== "closed") {
        try {
          void audioContextRef.current?.close();
        } catch {
          // ignore
        }
      }
    };
  }, [cleanupSource]);

  return { state, effectiveEngineId, startSection, pause, resume, close };
}
