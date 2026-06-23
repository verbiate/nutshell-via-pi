"use client";

import { useRef, useState, useCallback, useEffect } from "react";

export type TtsState = "IDLE" | "LOADING" | "GENERATING" | "READY" | "PLAYING" | "ENDED";

export interface TtsPlaybackState {
  state: TtsState;
  sectionTitle: string;
  sectionHref: string;
  audioUrl: string | null;
  audioId: string | null;
  currentTime: number;
  duration: number;
}

export interface UseTtsPlaybackOptions {
  bookId: string;
  toc: Array<{ label: string; href: string; subitems?: Array<{ label: string; href: string }> }>;
  currentHref: string;
  onNavigateToSection: (href: string) => void;
}

export interface UseTtsPlaybackReturn {
  state: TtsPlaybackState;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  startSection: (href: string, title: string) => void;
  togglePlayPause: () => void;
  scrub: (time: number) => void;
  close: () => void;
}

export function useTtsPlayback(options: UseTtsPlaybackOptions): UseTtsPlaybackReturn {
  const { bookId, toc, currentHref, onNavigateToSection } = options;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [state, setState] = useState<TtsPlaybackState>({
    state: "IDLE",
    sectionTitle: "",
    sectionHref: "",
    audioUrl: null,
    audioId: null,
    currentTime: 0,
    duration: 0,
  });

  // Flatten TOC for sequential navigation
  const flatToc = useCallback(() => {
    const items: Array<{ label: string; href: string }> = [];
    function walk(nodes: typeof toc) {
      for (const node of nodes) {
        items.push({ label: node.label, href: node.href });
        if (node.subitems) walk(node.subitems);
      }
    }
    walk(toc);
    return items;
  }, [toc]);

  const getNextSection = useCallback(
    (href: string) => {
      const items = flatToc();
      const idx = items.findIndex((i) => i.href === href);
      return idx >= 0 && idx < items.length - 1 ? items[idx + 1] : null;
    },
    [flatToc]
  );

  const startSection = useCallback(
    async (href: string, title: string) => {
      // Cancel any in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }

      setState((s) => ({
        ...s,
        state: "GENERATING",
        sectionTitle: title,
        sectionHref: href,
        audioUrl: null,
        audioId: null,
        currentTime: 0,
        duration: 0,
      }));

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/tts/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId, sectionHref: href }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        setState((s) => ({
          ...s,
          state: "READY",
          audioUrl: data.url,
          audioId: data.audioId,
        }));

        // Auto-play
        if (audioRef.current) {
          audioRef.current.src = data.url;
          audioRef.current.play().catch(() => {});
        }

        // Pre-buffer next section (fire-and-forget)
        const next = getNextSection(href);
        if (next) {
          fetch("/api/tts/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookId, sectionHref: next.href }),
          }).catch(() => {});
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          setState((s) => ({ ...s, state: "IDLE" }));
        } else {
          setState((s) => ({ ...s, state: "IDLE" }));
          console.error("[TTS] Generation failed:", err);
        }
      }
    },
    [bookId, getNextSection]
  );

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (state.state === "PLAYING") {
      audio.pause();
    } else if (state.state === "READY" || state.state === "ENDED") {
      audio.play().catch(() => {});
    } else if (state.state === "GENERATING") {
      // Cancel generation
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      setState((s) => ({ ...s, state: "IDLE" }));
    }
  }, [state.state]);

  const scrub = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio || state.state === "GENERATING") return;
      audio.currentTime = time;
      setState((s) => ({ ...s, currentTime: time }));
    },
    [state.state]
  );

  const close = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    setState({
      state: "IDLE",
      sectionTitle: "",
      sectionHref: "",
      audioUrl: null,
      audioId: null,
      currentTime: 0,
      duration: 0,
    });
  }, []);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => setState((s) => ({ ...s, state: "PLAYING" }));
    const handlePause = () => setState((s) => ({ ...s, state: "PLAYING" }));
    const handleTimeUpdate = () =>
      setState((s) => ({ ...s, currentTime: audio.currentTime }));
    const handleLoadedMetadata = () =>
      setState((s) => ({ ...s, duration: audio.duration }));
    const handleEnded = () => {
      setState((s) => ({ ...s, state: "ENDED" }));
      // Auto-advance after brief delay so ENDED state is visible
      const next = getNextSection(state.sectionHref);
      if (next) {
        setTimeout(() => {
          onNavigateToSection(next.href);
          startSection(next.href, next.label);
        }, 500);
      } else {
        setState((s) => ({ ...s, state: "IDLE" }));
      }
    };
    const handleError = () => {
      setState((s) => ({ ...s, state: "IDLE" }));
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [state.sectionHref, getNextSection, onNavigateToSection, startSection]);

  return { state, audioRef, startSection, togglePlayPause, scrub, close };
}
