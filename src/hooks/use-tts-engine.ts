"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

        if (!isAudioBufferResult(result)) {
          throw new Error(
            `Engine "${engineId}" returned unsupported result kind: ${result.kind}`,
          );
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
    [bookLanguage, engineId, onSectionComplete, speed, voiceId],
  );

  const startSection = useCallback(
    async (href: string, title: string) => {
      abortRef.current = false;
      runningRef.current = true;
      cleanupSource();

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

        const engine = await getEngine(engineId);
        await engine.ensureLoaded((pct) => {
          setState((s) => ({ ...s, loadPct: pct }));
        });

        if (!runningRef.current || abortRef.current) return;

        const limits = CHUNK_LIMITS[engineId];
        if (!limits) {
          throw new Error(`No chunk limits for engine "${engineId}"`);
        }

        chunksRef.current = chunkText(text, limits);
        currentIndexRef.current = 0;

        if (!audioContextRef.current) {
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
    [cleanupSource, engineId, onSectionComplete, playChunk, viewerRef],
  );

  const pause = useCallback(() => {
    if (state.phase !== "PLAYING") return;
    runningRef.current = false;
    cleanupSource();
    audioContextRef.current?.suspend();
    setState((s) => ({ ...s, phase: "PAUSED" }));
  }, [cleanupSource, state.phase]);

  const resume = useCallback(() => {
    if (state.phase !== "PAUSED") return;
    runningRef.current = true;
    setState((s) => ({ ...s, phase: "LOADING" }));
    void getEngine(engineId).then((engine) =>
      playChunk(engine, currentIndexRef.current),
    );
  }, [engineId, playChunk, state.phase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
      cleanupSource();
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
