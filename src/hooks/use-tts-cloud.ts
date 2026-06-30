"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { TtsPlaybackState } from "./use-tts-playback";

// ponytail: cloud mirror of useTtsPlayback. Adds /api/tts/usage-check
// pre-flight before each generation, surfaces a quota snapshot, and fires
// onQuotaExhausted (100%) + a soft toast (80%). 100% auto-disables cloud;
// the dispatcher in reader-client switches engine pref to kokoro on signal.
// Ceiling: the pre-flight is a separate round-trip per generation. If latency
// hurts, fold it into /api/tts/generate and have the route return the new
// quota snapshot — saves one HTTP call per section.

export interface CloudQuota {
  used: number;
  limit: number;
  periodKey: string;
}

export interface UseTtsCloudOptions {
  bookId: string;
  toc: Array<{
    label: string;
    href: string;
    subitems?: Array<{ label: string; href: string }>;
  }>;
  /**
   * External `<audio>` element ref. The hook wires playback through this
   * element; the parent owns the JSX so the hidden audio markup lives next
   * to the reader chrome. Keeping the ref out of the hook return avoids
   * tripping the react-hooks/refs lint rule on the composite return value.
   */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** Fired when a section finishes playing. The caller decides whether to advance. */
  onSectionComplete?: () => void;
  /** Fired when usage crosses 100% (or generate returns 429). */
  onQuotaExhausted?: () => void;
  /** Initial quota so the badge paints before the first fetch resolves. */
  initialQuota?: CloudQuota | null;
  /**
   * When false, skips the mount-time usage-check fetch. Set to false for
   * users who can't access cloud (regular tier) so the reader doesn't pay
   * for a round-trip whose result is never shown.
   */
  enabled?: boolean;
}

export interface UseTtsCloudReturn {
  state: TtsPlaybackState;
  quota: CloudQuota | null;
  // ponytail: seekRatio lets the caller start the section-level cloud audio
  // somewhere other than 0. Approximate — based on the visible block's char
  // offset / total section chars. Cloud still generates the full section; we
  // just jump playback after it loads.
  startSection: (
    href: string,
    title: string,
    opts?: { seekRatio?: number },
    bookIdOverride?: string,
  ) => void;
  togglePlayPause: () => void;
  scrub: (time: number) => void;
  close: () => void;
  refreshQuota: () => Promise<void>;
}

const IDLE_STATE: TtsPlaybackState = {
  state: "IDLE",
  sectionTitle: "",
  sectionHref: "",
  audioUrl: null,
  audioId: null,
  currentTime: 0,
  duration: 0,
};

export function useTtsCloud(options: UseTtsCloudOptions): UseTtsCloudReturn {
  const {
    bookId,
    toc,
    audioRef,
    onSectionComplete,
    onQuotaExhausted,
    initialQuota = null,
    enabled = true,
  } = options;

  const abortRef = useRef<AbortController | null>(null);
  // ponytail: latch the 80% warning per period so we don't toast on every
  // generation once crossed. Resets when the periodKey changes.
  const warnedPeriodRef = useRef<string | null>(null);
  // ponytail: latch the 100% exhaustion per period — mirrors warnedPeriodRef.
  // When periodKey rolls over (new month), the next limit hit fires the toast
  // and onQuotaExhausted again instead of being silently suppressed.
  const exhaustedPeriodRef = useRef<string | null>(null);
  // ponytail: latest quota in a ref so the startSection closure (memoized on
  // bookId/toc only) sees fresh values without re-creating per fetch.
  const quotaRef = useRef<CloudQuota | null>(initialQuota);
  // ponytail: cloud audio is one section-level blob; when starting from the
  // current page, stash the proportional seek target and apply it once the
  // audio metadata loads. Approximate (char offset / total chars), so it may
  // land within a sentence of the visible block.
  const pendingSeekRatioRef = useRef<number>(0);
  const onQuotaExhaustedRef = useRef(onQuotaExhausted);
  useEffect(() => {
    onQuotaExhaustedRef.current = onQuotaExhausted;
  });

  const [state, setState] = useState<TtsPlaybackState>(IDLE_STATE);
  const [quota, setQuota] = useState<CloudQuota | null>(initialQuota);

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
    [flatToc],
  );

  const applyQuota = useCallback(
    (next: CloudQuota) => {
      quotaRef.current = next;
      setQuota(next);
      // 80% soft warning — once per period.
      if (
        next.limit > 0 &&
        next.used / next.limit >= 0.8 &&
        warnedPeriodRef.current !== next.periodKey
      ) {
        warnedPeriodRef.current = next.periodKey;
        const remaining = Math.max(0, next.limit - next.used);
        toast.warning(
          `Premium TTS: ${remaining} generation${remaining === 1 ? "" : "s"} left this month.`,
        );
      }
    },
    [],
  );

  const refreshQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/tts/usage-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) return;
      const data = (await res.json()) as CloudQuota & { allowed?: boolean };
      applyQuota({
        used: data.used,
        limit: data.limit,
        periodKey: data.periodKey,
      });
    } catch {
      // ponytail: non-blocking — the badge just stays stale.
    }
  }, [applyQuota]);

  // ponytail: prime quota on mount; the badge needs it before the first
  // generation fires. Skips the network round-trip when the parent already
  // passed an initialQuota (e.g. server-rendered or cached). setState lives
  // inside the async fetch promise, not synchronously in the effect body —
  // eslint flags the call site anyway; one-shot hydration, same pattern as
  // the loadTtsPref effect in reader-client.
  useEffect(() => {
    if (!enabled) return;
    if (initialQuota) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshQuota();
  }, [enabled, initialQuota, refreshQuota]);

  const triggerExhausted = useCallback(() => {
    const periodKey = quotaRef.current?.periodKey ?? "";
    if (exhaustedPeriodRef.current === periodKey) return;
    exhaustedPeriodRef.current = periodKey;
    toast.error(
      "Monthly Premium TTS limit reached. Switched to Free (Kokoro).",
    );
    onQuotaExhaustedRef.current?.();
  }, []);

  const startSection = useCallback(
    async (
      href: string,
      title: string,
      opts?: { seekRatio?: number },
      bookIdOverride?: string,
    ) => {
      // ponytail: prefer the caller-provided bookId; the hook-level bookId
      // (from the session) is stale during a cross-book switch.
      const bid = bookIdOverride ?? bookId;
      // ponytail: stash the proportional seek target. Applied after the audio
      // element loads metadata so playback starts near the visible block.
      pendingSeekRatioRef.current = Math.min(
        Math.max(opts?.seekRatio ?? 0, 0),
        0.999,
      );

      if (abortRef.current) abortRef.current.abort();

      setState({
        state: "GENERATING",
        sectionTitle: title,
        sectionHref: href,
        audioUrl: null,
        audioId: null,
        currentTime: 0,
        duration: 0,
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // 1) Quota pre-flight. If we already know we're at the limit from the
        // last snapshot, short-circuit without a round-trip. The route still
        // re-checks authoritatively; this is just UX.
        const current = quotaRef.current;
        if (current && current.used >= current.limit) {
          triggerExhausted();
          setState(IDLE_STATE);
          return;
        }

        const checkRes = await fetch("/api/tts/usage-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: controller.signal,
        });
        if (checkRes.ok) {
          const check = (await checkRes.json()) as CloudQuota & {
            allowed?: boolean;
          };
          applyQuota(check);
          if (!check.allowed) {
            triggerExhausted();
            setState(IDLE_STATE);
            return;
          }
        }

        // 2) Generate.
        const res = await fetch("/api/tts/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId: bid, sectionHref: href }),
          signal: controller.signal,
        });

        if (res.status === 429) {
          // ponytail: route-side gate fired (e.g. race with another tab).
          const body = (await res.json().catch(() => ({}))) as {
            used?: number;
            limit?: number;
          };
          if (typeof body.used === "number" && typeof body.limit === "number") {
            applyQuota({
              used: body.used,
              limit: body.limit,
              periodKey: quotaRef.current?.periodKey ?? "",
            });
          }
          triggerExhausted();
          setState(IDLE_STATE);
          return;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          url: string;
          audioId: string;
          cached?: boolean;
        };

        setState((s) => ({
          ...s,
          state: "READY",
          audioUrl: data.url,
          audioId: data.audioId,
        }));

        if (audioRef.current) {
          audioRef.current.src = data.url;
          const ratio = pendingSeekRatioRef.current;
          pendingSeekRatioRef.current = 0;
          if (ratio > 0) {
            // ponytail: defer play until metadata loads so we can seek before
            // any audio reaches the speaker. { once: true } prevents a stale
            // listener from firing on a later section.
            const audio = audioRef.current;
            const onMeta = () => {
              audio.currentTime = ratio * (audio.duration || 0);
              audio.play().catch(() => {});
            };
            audio.addEventListener("loadedmetadata", onMeta, { once: true });
          } else {
            audioRef.current.play().catch(() => {});
          }
        }

        // 3) Optimistically bump local count — server already incremented.
        // refreshQuota() on next tick keeps it honest.
        const prev = quotaRef.current;
        if (prev) {
          applyQuota({ ...prev, used: prev.used + 1 });
        }
        void refreshQuota();
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e?.name === "AbortError") {
          setState((s) => ({ ...s, state: "IDLE" }));
        } else {
          setState(IDLE_STATE);
          console.error("[TTS cloud] generation failed:", err);
          toast.error("Premium audio generation failed. Try again.");
        }
      }
    },
    [bookId, applyQuota, refreshQuota, triggerExhausted],
  );

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (state.state === "PLAYING") {
      audio.pause();
    } else if (state.state === "READY" || state.state === "ENDED") {
      audio.play().catch(() => {});
    } else if (state.state === "GENERATING") {
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
    [state.state],
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
    pendingSeekRatioRef.current = 0;
    setState(IDLE_STATE);
  }, []);

  // Audio element event wiring — same shape as use-tts-playback.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => setState((s) => ({ ...s, state: "PLAYING" }));
    const handlePause = () =>
      setState((s) => ({
        ...s,
        state: s.state === "ENDED" ? "ENDED" : "READY",
      }));
    const handleTimeUpdate = () =>
      setState((s) => ({ ...s, currentTime: audio.currentTime }));
    const handleLoadedMetadata = () =>
      setState((s) => ({ ...s, duration: audio.duration }));
    const handleEnded = () => {
      // ponytail: fire onSectionComplete unconditionally so AudioProvider's
      // handleSectionComplete runs even at end-of-flat-toc (it clears the
      // session there). Without this, the cloud engine reached IDLE with the
      // session still set, which surfaced as the player card showing "Start
      // reading from here" but the play button doing nothing.
      const next = getNextSection(state.sectionHref);
      setState((s) => ({ ...s, state: next ? "ENDED" : "IDLE" }));
      onSectionComplete?.();
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
  }, [state.sectionHref, getNextSection, onSectionComplete, startSection]);

  return {
    state,
    quota,
    startSection,
    togglePlayPause,
    scrub,
    close,
    refreshQuota,
  };
}
