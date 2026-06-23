"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { EpubViewerHandle } from "@/components/reader/epub-viewer";
import { chunkText, CHUNK_LIMITS } from "@/lib/tts/chunk";
import { getEngine } from "@/lib/tts/engines";
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

function getSpeechSynthesis(): SpeechSynthesis | null {
  const env = globalThis as unknown as { speechSynthesis?: SpeechSynthesis };
  return env.speechSynthesis ?? null;
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
  }, [cleanupSource]);

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

      try {
        const result = await engine.synthesize(chunksRef.current[index], {
          voiceId,
          lang: bookLanguage,
          speed,
        });

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
        if (!abortRef.current) {
          console.error("[TTS] Synthesis failed:", err);
          setState((s) => ({
            ...s,
            phase: "IDLE",
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }
    },
    [bookLanguage, onSectionComplete, speed, voiceId],
  );

  // ponytail: try the requested engine; if its model load fails (no WebGPU,
  // OOM, network), fall back to the zero-download browser engine and toast.
  const resolveEngine = useCallback(async (): Promise<TtsEngine> => {
    try {
      const engine = await getEngine(engineIdRef.current);
      await engine.ensureLoaded((pct) => {
        setState((s) => ({ ...s, loadPct: pct }));
      });
      engineRef.current = engine;
      return engine;
    } catch (primaryErr) {
      if (engineIdRef.current === "browser") throw primaryErr;
      toast("Switching to built-in voice");
      engineIdRef.current = "browser";
      const fallback = await getEngine("browser");
      await fallback.ensureLoaded();
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

      setState({
        phase: "LOADING",
        loadPct: 0,
        sectionTitle: title,
        sectionHref: href,
      });

      try {
        await viewerRef.current?.navigateTo(href);
        const text = viewerRef.current?.getSectionText() ?? "";
        if (!text.trim()) {
          setState((s) => ({ ...s, phase: "ENDED" }));
          onSectionComplete?.();
          return;
        }

        const engine = await resolveEngine();

        if (!runningRef.current || abortRef.current) return;

        const limits = CHUNK_LIMITS[engineIdRef.current];
        if (!limits) {
          throw new Error(`No chunk limits for engine "${engineIdRef.current}"`);
        }

        chunksRef.current = chunkText(text, limits);
        currentIndexRef.current = 0;

        // ponytail: AudioBuffer path needs an AudioContext; the browser path
        // bypasses it entirely (see playChunk).
        if (!isBrowserEngine(engine) && !audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }

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

  return { state, startSection, pause, resume, close };
}
