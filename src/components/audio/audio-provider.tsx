"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { NavItem } from "@likecoin/epub-ts";
import { AudioContext } from "./audio-context";
import type {
  AudioContextValue,
  AudioSession,
  BookAudioContext,
  FlatSection,
} from "./audio-context";
import { TtsPlayer } from "@/components/reader/tts-player";
import type { TtsPlaybackState } from "@/hooks/use-tts-playback";
import { useTtsEngine } from "@/hooks/use-tts-engine";
import { useTtsCloud } from "@/hooks/use-tts-cloud";
import {
  defaultEngineForLanguage,
  engineSupportsLanguage,
  type EngineId,
} from "@/lib/tts/languages";
import { ENGINES } from "@/lib/tts/engines";
import { loadTtsPref, saveTtsPref } from "@/lib/tts/pref";
import { countWords, estimateSeconds, FALLBACK_WPM } from "@/lib/tts/estimate";
import { cn } from "@/lib/utils";

function flattenToc(toc: NavItem[]): FlatSection[] {
  const out: FlatSection[] = [];
  function walk(items: NavItem[]) {
    for (const it of items) {
      out.push({ label: it.label, href: it.href, index: out.length });
      if (it.subitems?.length) walk(it.subitems);
    }
  }
  walk(toc);
  return out;
}

function resolveSectionTitle(toc: NavItem[], href: string): string {
  const norm = (h: string) => h.split("#")[0].split("?")[0];
  const target = norm(href);
  const base = target.split("/").pop() ?? target;
  const walk = (items: NavItem[]): string => {
    for (const it of items) {
      const n = norm(it.href);
      if (n === target || n === base || (n.split("/").pop() ?? n) === base) {
        return it.label;
      }
      if (it.subitems?.length) {
        const found = walk(it.subitems);
        if (found) return found;
      }
    }
    return "";
  };
  return walk(toc);
}

function createSession(
  ctx: BookAudioContext,
  currentIndex = 0,
): AudioSession {
  return {
    bookId: ctx.bookId,
    bookTitle: ctx.bookTitle,
    bookAuthor: ctx.bookAuthor,
    bookLanguage: ctx.bookLanguage,
    flatToc: flattenToc(ctx.toc),
    userRole: ctx.userRole,
    currentIndex,
    voiceSpeed: ctx.voiceSpeed,
  };
}

export function AudioProvider({ children }: { children: React.ReactNode }) {
  // ponytail: engine/voice prefs are global to the app session, not per-book.
  const [enginePref, setEnginePref] = useState<EngineId>(() =>
    defaultEngineForLanguage("en"),
  );
  const [voicePref, setVoicePref] = useState<string>("");

  // The currently open book (reader mounted) and the active playback session
  // (may be a different book when the user keeps audio playing while browsing).
  const [openBook, setOpenBook] = useState<BookAudioContext | null>(null);
  const [session, setSession] = useState<AudioSession | null>(null);

  // Ref mirrors for stable callbacks wired to audio events.
  const openBookRef = useRef(openBook);
  const sessionRef = useRef(session);
  useEffect(() => {
    openBookRef.current = openBook;
  }, [openBook]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Viewer ref holder: the reader registers its EpubViewer ref here so
  // highlight-follow-along works when on-reader; off-reader it is null.
  const [registeredViewer, setRegisteredViewer] = useState<React.RefObject<
    import("@/components/reader/epub-viewer").EpubViewerHandle | null
  > | null>(null);

  // Cloud audio element, owned by the provider so it survives route changes.
  const cloudAudioRef = useRef<HTMLAudioElement | null>(null);

  // Refs to the hook APIs so callbacks defined before the hooks (e.g. the
  // text source) or that must stay stable can dispatch to the current engine.
  const browserTtsRef = useRef<ReturnType<typeof useTtsEngine> | null>(null);
  const cloudTtsRef = useRef<ReturnType<typeof useTtsCloud> | null>(null);

  // ponytail: reader pushes its chrome-hidden flag here; the floating card
  // mirrors on-reader controls instead of tracking pointer idle itself.
  const [readerControlsHidden, setReaderControlsHidden] = useState(false);

  // ponytail: hydrate saved engine/voice once at app start. Runs in useEffect
  // to avoid SSR hydration mismatch (navigator doesn't exist on server).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = loadTtsPref("en");
    if (saved.engineId && engineSupportsLanguage(saved.engineId, "en")) {
      setEnginePref(saved.engineId);
    }
    if (saved.voiceId) {
      setVoicePref(saved.voiceId);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ponytail: no WebGPU (Safari stable, older Firefox) → drop Kokoro/Supertonic
  // to browser immediately so the user isn't stuck on a doomed load.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof navigator !== "undefined" && !("gpu" in navigator)) {
      setEnginePref((prev) =>
        prev === "kokoro" || prev === "supertonic" ? "browser" : prev,
      );
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist resolved prefs once voice has settled.
  useEffect(() => {
    if (!voicePref) return;
    saveTtsPref("en", { engineId: enginePref, voiceId: voicePref });
  }, [enginePref, voicePref]);

  // Snap voicePref to the active engine's catalog when engine or language changes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const lang = session?.bookLanguage ?? openBook?.bookLanguage ?? "en";
    const activeEngine = ENGINES[enginePref];
    const voices = activeEngine?.getVoices(lang) ?? [];
    if (voices.length === 0) {
      if (voicePref !== "") setVoicePref("");
      return;
    }
    if (!voices.some((v) => v.id === voicePref)) {
      setVoicePref(voices[0].id);
    }
  }, [enginePref, openBook?.bookLanguage, session?.bookLanguage, voicePref]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ─── Text source strategy ──────────────────────────────────────────────────
  // In-reader: prefer the live iframe (no navigation if already on section);
  // off-reader / playlist jumps: fetch from the server endpoint.
  const getText = useCallback(async (href: string): Promise<string> => {
    const bookId =
      sessionRef.current?.bookId ?? openBookRef.current?.bookId;
    if (!bookId) return "";

    const viewer = registeredViewer?.current;
    const currentHref = openBookRef.current?.currentHref;

    if (viewer) {
      if (currentHref !== href) {
        await viewer.navigateTo(href);
      }
      return viewer.getSectionText() ?? "";
    }

    const res = await fetch("/api/reader/section-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, sectionHref: href }),
    });
    if (!res.ok) {
      throw new Error(`Failed to load section text: ${res.status}`);
    }
    const data = (await res.json()) as { text?: string };
    return data.text ?? "";
  }, []);

  // ─── Section completion (wired into the hooks below) ───────────────────────
  const handleSectionComplete = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const nextIndex = s.currentIndex + 1;
    if (nextIndex >= s.flatToc.length) {
      // End of book: leave state as ENDED.
      return;
    }
    const next = s.flatToc[nextIndex];
    setSession((prev) => (prev ? { ...prev, currentIndex: nextIndex } : prev));
    const isCloudNow = enginePref === "cloud" && s.userRole !== "regular";
    if (isCloudNow) {
      cloudTtsRef.current?.startSection(next.href, next.label);
    } else {
      browserTtsRef.current?.startSection(next.href, next.label);
    }
  }, [enginePref]);

  // ─── Hooks ─────────────────────────────────────────────────────────────────
  const browserTts = useTtsEngine({
    bookId: session?.bookId ?? "",
    bookLanguage: session?.bookLanguage ?? "en",
    getText,
    viewerRef: registeredViewer ?? undefined,
    engineId: enginePref,
    voiceId: voicePref,
    speed: session?.voiceSpeed ?? 1,
    onSectionComplete: handleSectionComplete,
  });

  const cloudTts = useTtsCloud({
    bookId: session?.bookId ?? "",
    toc: session?.flatToc ?? [],
    audioRef: cloudAudioRef,
    onSectionComplete: handleSectionComplete,
    onQuotaExhausted: useCallback(() => setEnginePref("kokoro"), []),
    enabled: session?.userRole !== "regular",
  });

  // ponytail: mirror hook APIs into refs so the action callbacks below can
  // dispatch without being recreated on every hook state change. Synced in an
  // effect (not during render) per react-hooks/refs rule.
  useEffect(() => {
    browserTtsRef.current = browserTts;
    cloudTtsRef.current = cloudTts;
  });

  const startSection = useCallback(
    (href: string, title: string) => {
      const s = sessionRef.current;
      const isCloudNow = enginePref === "cloud" && s?.userRole !== "regular";
      // ponytail: cloud doesn't go through getText, so navigate the reader's
      // viewer here to keep it in sync on auto-advance / playlist jumps. Skip
      // when already on the section (initial "Listen from here"). The browser
      // path navigates via getText instead.
      if (
        isCloudNow &&
        openBookRef.current?.currentHref !== href
      ) {
        registeredViewer?.current?.navigateTo(href).catch(() => {});
      }
      if (isCloudNow) {
        cloudTtsRef.current?.startSection(href, title);
      } else {
        browserTtsRef.current?.startSection(href, title);
      }
    },
    [enginePref, registeredViewer],
  );

  // ─── Cloud generation duration estimate ────────────────────────────────────
  const [cloudGenEstimate, setCloudGenEstimate] = useState(0);
  useEffect(() => {
    const cs = cloudTts.state;
    const s = sessionRef.current;
    if (
      enginePref !== "cloud" ||
      cs.state !== "GENERATING" ||
      cs.duration > 0 ||
      !s
    ) {
      setCloudGenEstimate(0);
      return;
    }
    const section = s.flatToc[s.currentIndex];
    if (!section) {
      setCloudGenEstimate(0);
      return;
    }
    let cancelled = false;
    getText(section.href)
      .then((text) => {
        if (cancelled) return;
        const words = countWords(text);
        setCloudGenEstimate(
          words > 0 ? estimateSeconds(words, FALLBACK_WPM, s.voiceSpeed) : 0,
        );
      })
      .catch(() => {
        if (!cancelled) setCloudGenEstimate(0);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePref, cloudTts.state, getText]);

  // ─── Derived playback state ────────────────────────────────────────────────
  const isCloud =
    enginePref === "cloud" && session?.userRole !== "regular";

  const playbackState: TtsPlaybackState = useMemo(() => {
    if (isCloud) {
      const cs = cloudTts.state;
      if (
        cs.state === "GENERATING" &&
        cs.duration === 0 &&
        cloudGenEstimate > 0
      ) {
        return { ...cs, duration: cloudGenEstimate };
      }
      return cs;
    }
    const phase = browserTts.state.phase;
    return {
      state:
        phase === "IDLE"
          ? "IDLE"
          : phase === "LOADING"
            ? "LOADING"
            : phase === "PLAYING"
              ? "PLAYING"
              : phase === "PAUSED"
                ? "READY"
                : "ENDED",
      sectionTitle: browserTts.state.sectionTitle,
      sectionHref: browserTts.state.sectionHref,
      audioUrl: null,
      audioId: null,
      currentTime: browserTts.state.currentTime,
      duration: browserTts.state.duration,
    };
  }, [browserTts.state, cloudTts.state, cloudGenEstimate, isCloud]);

  // ─── Cloud audio playback speed ────────────────────────────────────────────
  useEffect(() => {
    const speed = session?.voiceSpeed ?? 1;
    if (cloudAudioRef.current) {
      cloudAudioRef.current.playbackRate = speed;
    }
  }, [session?.voiceSpeed, cloudAudioRef, cloudTts.state.state]);

  // ─── Actions exposed to consumers ──────────────────────────────────────────
  const registerBook = useCallback((ctx: BookAudioContext) => {
    setOpenBook(ctx);
  }, []);

  const registerViewer = useCallback(
    (ref: React.RefObject<
      import("@/components/reader/epub-viewer").EpubViewerHandle | null
    >) => {
      setRegisteredViewer(ref);
    },
    [],
  );

  const unregisterViewer = useCallback(() => {
    setRegisteredViewer(null);
  }, []);

  const playPause = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const isCloudNow = enginePref === "cloud" && s.userRole !== "regular";
    if (isCloudNow) {
      cloudTts.togglePlayPause();
      return;
    }
    const phase = browserTts.state.phase;
    if (phase === "PLAYING") {
      browserTts.pause();
    } else if (phase === "PAUSED") {
      browserTts.resume();
    } else if (phase === "IDLE" || phase === "ENDED") {
      const section = s.flatToc[s.currentIndex];
      if (section) browserTts.startSection(section.href, section.label);
    }
  }, [enginePref, browserTts, cloudTts]);

  const startFromHere = useCallback((overrideHref?: string, overrideLabel?: string) => {
    const open = openBookRef.current;
    if (!open) return;

    const href = overrideHref ?? open.currentHref;
    const flatToc = flattenToc(open.toc);
    const currentFlat = flatToc.find((i) => i.href === href);
    const currentIndex = currentFlat?.index ?? 0;
    const title =
      overrideLabel ||
      currentFlat?.label ||
      resolveSectionTitle(open.toc, href) ||
      open.bookTitle ||
      "Reading";

    const s = sessionRef.current;
    const sameBook = s?.bookId === open.bookId;
    const sameSection =
      sameBook && s.flatToc[s.currentIndex]?.href === href;

    if (sameBook && sameSection) {
      playPause();
      return;
    }

    if (!sameBook) {
      const wasCloud =
        enginePref === "cloud" && s?.userRole !== "regular";
      if (wasCloud) cloudTts.close();
      else browserTts.close();
      setSession(createSession(open, currentIndex));
    } else {
      setSession((prev) =>
        prev ? { ...prev, currentIndex } : prev,
      );
    }
    startSection(href, title);
  }, [
    enginePref,
    browserTts.close,
    cloudTts.close,
    playPause,
    startSection,
  ]);

  // ponytail: idle card's play button. No session yet → start; otherwise toggle.
  const handlePlayPause = useCallback(() => {
    if (!sessionRef.current) {
      startFromHere();
      return;
    }
    playPause();
  }, [startFromHere, playPause]);

  const stop = useCallback(() => {
    const s = sessionRef.current;
    const isCloudNow = enginePref === "cloud" && s?.userRole !== "regular";
    if (isCloudNow) {
      cloudTts.close();
    } else {
      browserTts.close();
    }
    setSession(null);
  }, [enginePref, browserTts.close, cloudTts.close]);

  const scrub = useCallback(
    (time: number) => {
      if (isCloud) cloudTts.scrub(time);
    },
    [isCloud, cloudTts.scrub],
  );

  const setEngine = useCallback(
    (id: EngineId) => {
      if (enginePref === id) return;
      // Stop the old engine so audio doesn't bleed across engines.
      const s = sessionRef.current;
      const wasCloud = enginePref === "cloud" && s?.userRole !== "regular";
      if (wasCloud) cloudTts.close();
      else browserTts.close();
      setEnginePref(id);
    },
    [enginePref, browserTts.close, cloudTts.close],
  );

  const setVoice = useCallback((id: string) => {
    setVoicePref(id);
  }, []);

  const jumpTo = useCallback(
    (index: number) => {
      const s = sessionRef.current;
      if (!s) return;
      const section = s.flatToc[index];
      if (!section) return;
      setSession((prev) => (prev ? { ...prev, currentIndex: index } : prev));
      startSection(section.href, section.label);
    },
    [startSection],
  );

  const onReader = registeredViewer !== null;
  const isActivelyPlaying =
    playbackState.state === "PLAYING" ||
    playbackState.state === "LOADING" ||
    playbackState.state === "GENERATING";
  // ponytail: mirror the reader's chrome-hidden flag; always show while audio is
  // actively playing. Off-reader the reader never pushes → stays false → visible.
  const cardHidden = readerControlsHidden && !isActivelyPlaying;
  // ponytail: show on-reader (idle + playing) or off-reader while a session
  // exists (keep-playing-while-browsing). Idle card surfaces the Start affordance.
  const showCard = !!openBook && (onReader || session !== null);

  // ─── Context value ─────────────────────────────────────────────────────────
  const value: AudioContextValue = useMemo(
    () => ({
      session,
      playbackState,
      activeEngineId: isCloud ? enginePref : browserTts.effectiveEngineId,
      loadPct: browserTts.state.loadPct,
      cloudQuota: cloudTts.quota,
      isCloud,
      canScrub: isCloud,
      onReader,
      setReaderControlsHidden,
      registerBook,
      registerViewer,
      unregisterViewer,
      startFromHere,
      playPause,
      stop,
      scrub,
      setEngine,
      setVoice,
      jumpTo,
    }),
    [
      session,
      playbackState,
      enginePref,
      browserTts.effectiveEngineId,
      browserTts.state.loadPct,
      cloudTts.quota,
      isCloud,
      onReader,
      setReaderControlsHidden,
      registerBook,
      registerViewer,
      unregisterViewer,
      startFromHere,
      playPause,
      stop,
      scrub,
      setEngine,
      setVoice,
      jumpTo,
    ],
  );

  return (
    <AudioContext.Provider value={value}>
      {children}
      <audio ref={cloudAudioRef} className="hidden" />
      {showCard && (
        <div
          className={cn(
            "fixed bottom-12 left-12 z-[60] w-[calc(100%-6rem)] max-w-[640px] transition-opacity duration-300",
            cardHidden && "opacity-0 pointer-events-none",
          )}
        >
          <TtsPlayer
            state={playbackState}
            loadPct={browserTts.state.loadPct}
            onPlayPause={handlePlayPause}
            onStop={stop}
            onScrub={scrub}
            bookLanguage={session?.bookLanguage ?? openBook?.bookLanguage ?? "en"}
            enginePref={enginePref}
            effectiveEngineId={isCloud ? enginePref : browserTts.effectiveEngineId}
            onEngineChange={setEngine}
            voicePref={voicePref}
            onVoiceChange={setVoice}
            userRole={session?.userRole ?? openBook?.userRole ?? "regular"}
            quota={isCloud ? cloudTts.quota : null}
            bookTitle={session?.bookTitle ?? openBook?.bookTitle}
            bookAuthor={session?.bookAuthor ?? openBook?.bookAuthor}
            canScrub={isCloud}
            playlist={session?.flatToc ?? (openBook ? flattenToc(openBook.toc) : undefined)}
            currentIndex={session?.currentIndex}
            onJumpTo={jumpTo}
            hidden={cardHidden}
          />
        </div>
      )}
    </AudioContext.Provider>
  );
}
