"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AudioContext } from "./audio-context";
import type {
  AudioContextValue,
  AudioSession,
  BookAudioContext,
  FlatSection,
} from "./audio-context";
import { buildSpinePlaylist } from "@/lib/reader/spine-playlist";
import { TtsPlayer } from "@/components/reader/tts-player";
import { useSceneTransition } from "@/components/transitions/scene-transition";
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

function createSession(
  ctx: BookAudioContext,
  currentIndex = 0,
): AudioSession {
  return {
    bookId: ctx.bookId,
    bookTitle: ctx.bookTitle,
    bookAuthor: ctx.bookAuthor,
    bookCoverPath: ctx.bookCoverPath,
    bookLanguage: ctx.bookLanguage,
    flatToc: buildSpinePlaylist(ctx.spineItems, ctx.toc),
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
  const { leavingReader, entering } = useSceneTransition();

  // The currently open book (reader mounted) and the active playback session
  // (may be a different book when the user keeps audio playing while browsing).
  const [openBook, setOpenBook] = useState<BookAudioContext | null>(null);
  const [session, setSession] = useState<AudioSession | null>(null);

  // ponytail: one-shot flag set by the floating player's thumbnail click when
  // the user is off-reader, so the reader syncs to the TTS position on mount
  // even if playback is paused (the normal auto-sync only fires while PLAYING).
  const [pendingReaderSyncBookId, setPendingReaderSyncBookId] = useState<
    string | null
  >(null);

  // Ref mirrors for stable callbacks wired to audio events.
  const openBookRef = useRef(openBook);
  const sessionRef = useRef(session);
  useEffect(() => {
    openBookRef.current = openBook;
  }, [openBook]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // ReaderClient registers this so the persistent player can reopen its sidebar.
  const detailsOpenerRef = useRef<(() => void) | null>(null);

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
        await viewer.navigateTo(href, { ttsNav: true });
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
    // ponytail: navigate the viewer to the new section BEFORE starting TTS.
    // Without this, highlightChunk is called for text that isn't in the
    // displayed section's DOM — matcher fails, no marks, no page turn.
    registeredViewerRef.current?.current?.navigateTo(next.href, { ttsNav: true });
    const isCloudNow = enginePref === "cloud" && s.userRole !== "regular";
    if (isCloudNow) {
      cloudTtsRef.current?.startSection(next.href, next.label);
    } else {
      browserTtsRef.current?.startSection(next.href, next.label);
    }
  }, [enginePref]);

  // ─── TTS read-aloud position persistence ────────────────────────────────────
  // ponytail: the last chunk spoken aloud IS the reading position. We persist
  // advances straight from here so a book reopened after off-reader playback
  // (audio kept running on the bookshelf) lands on the spoken chunk's page.
  // Browser/Kokoro path gets chunk precision via onChunkAdvance; cloud gets
  // section-level via startSection. Debounced ~1.5s; flushed on stop + tab hide.
  const ttsPosPendingRef = useRef<{
    bookId: string;
    sectionHref: string;
    ttsChunkAnchor?: string;
  } | null>(null);
  const ttsPosTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ponytail: mirror registeredViewer into a ref so scheduleTtsPosSave (stable
  // callback) can read the current mount state without rebuilding on every
  // register/unregister.
  const registeredViewerRef = useRef(registeredViewer);
  useEffect(() => {
    registeredViewerRef.current = registeredViewer;
  }, [registeredViewer]);

  const flushTtsPosSave = useCallback(() => {
    if (ttsPosTimerRef.current) {
      clearTimeout(ttsPosTimerRef.current);
      ttsPosTimerRef.current = null;
    }
    const pending = ttsPosPendingRef.current;
    ttsPosPendingRef.current = null;
    if (!pending) return;
    // ponytail: best-effort CFI when the reader is mounted — gives precise
    // display(cfi) restore. Off-reader (viewer null) we rely on the anchor.
    // Read via the ref mirror so this callback stays stable (no state in deps)
    // and the React Compiler can preserve the memoization.
    const cfi =
      registeredViewerRef.current?.current?.getCurrentCfi() ?? undefined;
    // ponytail: section-proxy percentage so the bookshelf progress bar doesn't
    // blank out after off-reader playback (it sources from `percentage`).
    // Coarse — section-level — but only used off-reader where we have no page.
    const flatToc = sessionRef.current?.flatToc ?? [];
    let percentage: number | undefined;
    if (flatToc.length > 0) {
      const idx = flatToc.findIndex(
        (s) => s.href === pending.sectionHref,
      );
      if (idx >= 0) {
        percentage = Math.round(((idx + 1) / flatToc.length) * 100);
      }
    }
    void fetch("/api/reader/position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: pending.bookId,
        paragraphIndex: 0,
        charOffset: 0,
        cfi,
        sectionHref: pending.sectionHref,
        ttsChunkAnchor: pending.ttsChunkAnchor,
        percentage,
      }),
    }).catch(() => {
      // non-blocking — position save is best-effort
    });
  }, []);

  const scheduleTtsPosSave = useCallback(
    (info: { sectionHref: string; ttsChunkAnchor?: string }) => {
      // ponytail: when the reader is mounted, the viewer's `relocated` event
      // already persists a page-precise CFI + percentage on every page turn
      // (including TTS-driven ones). Writing here too would clobber percentage
      // with null and the anchor with a coarser signal. Only write off-reader —
      // that's the case the relocated path can't see and the anchor exists for.
      if (registeredViewerRef.current) return;
      const bookId = sessionRef.current?.bookId;
      if (!bookId || !info.sectionHref) return;
      ttsPosPendingRef.current = {
        bookId,
        sectionHref: info.sectionHref,
        ttsChunkAnchor: info.ttsChunkAnchor,
      };
      if (ttsPosTimerRef.current) clearTimeout(ttsPosTimerRef.current);
      ttsPosTimerRef.current = setTimeout(() => flushTtsPosSave(), 1500);
    },
    [flushTtsPosSave],
  );

  // Flush the last spoken position when the tab is hidden — the provider never
  // unmounts, so this is the close analog of the reader's unmount flush.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushTtsPosSave();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flushTtsPosSave]);

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
    onChunkAdvance: (info) =>
      scheduleTtsPosSave({
        sectionHref: info.sectionHref,
        ttsChunkAnchor: info.anchorText || undefined,
      }),
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
    (
      href: string,
      title: string,
      startPos?: { elementId?: string; useVisible?: boolean; startCfi?: string },
    ) => {
      const s = sessionRef.current;
      const isCloudNow = enginePref === "cloud" && s?.userRole !== "regular";
      if (isCloudNow) {
        // ponytail: cloud audio is one blob per section. When starting from the
        // current page or a selection, approximate the audio seek point by the
        // character offset / total section characters. Proportional, so it may
        // land within a sentence; upgrade path is server-side time mapping.
        let seekRatio: number | undefined;
        if (startPos && (startPos.useVisible || startPos.startCfi)) {
          const viewer = registeredViewerRef.current?.current;
          if (viewer) {
            const offset = viewer.getTtsStartOffset(startPos);
            const total = viewer.getSectionText().length;
            if (total > 0) {
              seekRatio = Math.min(Math.max(offset / total, 0), 0.999);
            }
          }
        }
        cloudTtsRef.current?.startSection(href, title, { seekRatio });
      } else {
        browserTtsRef.current?.startSection(href, title, startPos);
      }
      // ponytail: persist the section being read. For cloud (section-level
      // audio, no chunk highlighting) this is the finest precision we get; for
      // the browser path, onChunkAdvance overrides with chunk precision next.
      scheduleTtsPosSave({ sectionHref: href });
    },
    [enginePref, scheduleTtsPosSave],
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

  const registerDetailsOpener = useCallback((fn: () => void) => {
    detailsOpenerRef.current = fn;
  }, []);

  const openBookDetails = useCallback(() => {
    detailsOpenerRef.current?.();
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

  // ponytail: catch a freshly-mounted viewer up to live playback. Called by the
  // reader after its rendition is ready when playback is active — navigates the
  // viewer to the section TTS is currently reading and lights up the chunk now
  // being spoken. Without this, a reader remount (bookshelf → back) lands on the
  // saved position while TTS reads a different section, so highlight-follow-
  // along silently misses until the next section boundary.
  const syncViewerToPlayback = useCallback(async (): Promise<boolean> => {
    const s = sessionRef.current;
    // ponytail: read via the ref mirror so this callback stays stable (no
    // state in deps) and the React Compiler can preserve the memoization.
    const viewer = registeredViewerRef.current?.current;
    if (!s || !viewer) return false;
    // ponytail: never hijack a different book's viewer — if the user opened book
    // B while book A's audio plays, B restores its own position and A keeps going.
    if (openBookRef.current?.bookId !== s.bookId) return false;
    const section = s.flatToc[s.currentIndex];
    if (!section) return false;

    // ponytail: only navigate when the viewer isn't already on the TTS section.
    // display(sectionHref) re-renders a section from its FIRST page, so calling
    // it when already here would reset the page and clobber the chunk the user
    // is looking at. When already here, clear stale marks and re-mark in place
    // (highlightChunk advances pages to the chunk if needed).
    const onSection = ttsSectionMatches(
      openBookRef.current?.currentHref ?? "",
      section.href,
    );
    if (!onSection) {
      try {
        await viewer.navigateTo(section.href, { ttsNav: true });
      } catch (err) {
        console.warn("[AudioProvider] syncViewerToPlayback nav failed:", err);
        return false;
      }
      // ponytail: wait for the iframe DOM of the target section to be ready,
      // otherwise highlightChunk reads the previous section's DOM and misses.
      await viewer.waitForRender();
    } else {
      viewer.clearTtsHighlight();
    }

    // Cloud engine has no chunk-level text; section-level navigation is enough.
    const chunk = browserTtsRef.current?.getCurrentChunk();
    if (!chunk?.chunkText) return true;
    try {
      await viewer.highlightChunk(chunk.chunkText);
      return true;
    } catch (err) {
      console.warn("[AudioProvider] syncViewerToPlayback highlight failed:", err);
      return false;
    }
  }, []);

  // ponytail: section hrefs can carry a #fragment (or query) that differs
  // between the rendition `rendered` event and the TOC href stored in
  // sectionHrefRef. Strip them, then fall back to a basename compare so a path
  // resolution mismatch (relative vs absolute) doesn't cause a false negative.
  function ttsSectionMatches(a: string, b: string): boolean {
    const strip = (h: string) => h.split("#")[0].split("?")[0].trim();
    const pa = strip(a);
    const pb = strip(b);
    if (pa === pb) return true;
    const base = (h: string) => h.split("/").pop() ?? h;
    return base(pa) === base(pb);
  }

  // ponytail: re-apply the TTS highlight after epub.js recreates a section's
  // iframe on a manual page-flip across a section boundary. Unlike
  // syncViewerToPlayback this does NOT navigate — the section that just
  // rendered is already current. Clear-first keeps it idempotent under the
  // double-fire from the ttsSyncedRef one-shot on initial mount.
  const rehighlightCurrentChunk = useCallback(async (renderedHref?: string) => {
    const s = sessionRef.current;
    const viewer = registeredViewerRef.current?.current;
    if (!s || !viewer) return;
    if (openBookRef.current?.bookId !== s.bookId) return;
    const chunk = browserTtsRef.current?.getCurrentChunk();
    if (!chunk?.chunkText) return;
    if (
      renderedHref &&
      chunk.sectionHref &&
      !ttsSectionMatches(renderedHref, chunk.sectionHref)
    )
      return;
    // ponytail: authoritative gate. During a TTS-driven section swap,
    // sectionHrefRef is updated eagerly (use-tts-engine.ts startSection) while
    // chunksRef still holds the PREVIOUS section's text — so getCurrentChunk
    // returns a chunk whose text isn't in the freshly-rendered DOM. Skip in
    // that case so we don't clear the engine's correct highlight or light a
    // wrong fallback block. Only re-apply when the chunk is genuinely present.
    if (!viewer.hasChunkText(chunk.chunkText)) return;
    try {
      await viewer.clearTtsHighlight();
      await viewer.highlightChunk(chunk.chunkText);
    } catch {
      // non-blocking — next chunk boundary retries naturally
    }
  }, []);

  const startFromHere = useCallback(async (
    overrideHref?: string,
    overrideLabel?: string,
    startPos?: { elementId?: string; useVisible?: boolean; startCfi?: string },
  ) => {
    const open = openBookRef.current;
    if (!open) return;

    const href = overrideHref ?? open.currentHref;
    const flatToc = buildSpinePlaylist(open.spineItems, open.toc);
    // ponytail: tolerant match (strip #fragment/?query + basename fallback) —
    // the relocated href and the normalized ToC href can drift on fragment or
    // path encoding, and a strict === silently dropped currentIndex to 0,
    // making the session think TTS is reading the book's first section.
    const currentFlat = flatToc.find((i) => ttsSectionMatches(i.href, href));
    const currentIndex = currentFlat?.index ?? 0;
    const title =
      overrideLabel ||
      currentFlat?.label ||
      open.bookTitle ||
      "Reading";

    const s = sessionRef.current;
    const sameBook = s?.bookId === open.bookId;
    const sameSection =
      sameBook &&
      ttsSectionMatches(s.flatToc[s.currentIndex]?.href ?? "", href);

    // ponytail: when a concrete startPos is supplied, the caller explicitly
    // wants to (re)start at that point (e.g. selection → "Start reading from
    // here"), so skip the same-section play/pause toggle and fall through.
    if (sameBook && sameSection && !startPos) {
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

    // ponytail: sidebar "play this section" should behave like "click to visit
    // the chapter" + "start reading from here". Always navigate the viewer to
    // the chosen href first (even if already on the same section, so we land at
    // its head/fragment), then start TTS. When overrideHref is undefined we're
    // starting from the current visible page — don't navigate.
    if (overrideHref) {
      await registeredViewerRef.current?.current
        ?.navigateTo(href, { ttsNav: true })
        .catch(() => {});
    }

    startSection(href, title, startPos);
  }, [
    enginePref,
    browserTts.close,
    cloudTts.close,
    playPause,
    startSection,
  ]);

  // ponytail: idle card's play button. No session yet → start from the current
  // reading position (useVisible so the engine resolves the viewer's first
  // visible block); otherwise toggle.
  const handlePlayPause = useCallback(() => {
    if (!sessionRef.current) {
      startFromHere(undefined, undefined, { useVisible: true });
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
    // ponytail: flush the last spoken chunk before tearing the session down so
    // the just-read position isn't lost to the debounce timer.
    flushTtsPosSave();
    setSession(null);
  }, [enginePref, browserTts.close, cloudTts.close, flushTtsPosSave]);

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
    async (index: number) => {
      const s = sessionRef.current;
      if (!s) return;
      const section = s.flatToc[index];
      if (!section) return;
      setSession((prev) => (prev ? { ...prev, currentIndex: index } : prev));
      await registeredViewerRef.current?.current
        ?.navigateTo(section.href, { ttsNav: true })
        .catch(() => {});
      startSection(section.href, section.label);
    },
    [startSection],
  );

  const markPendingReaderSync = useCallback((bookId: string) => {
    setPendingReaderSyncBookId(bookId);
  }, []);

  const clearPendingReaderSync = useCallback(() => {
    setPendingReaderSyncBookId(null);
  }, []);

  const onReader = registeredViewer !== null;
  const isActivelyPlaying =
    playbackState.state === "PLAYING" ||
    playbackState.state === "LOADING" ||
    playbackState.state === "GENERATING";
  // ponytail: mirror the reader's chrome-hidden flag; always show while audio is
  // actively playing. Off-reader the reader never pushes → stays false → visible.
  const cardHidden = readerControlsHidden && !isActivelyPlaying;
  // Fade the idle player during the reader→library back transition so it
  // doesn't pop at route swap. Active sessions (playing/paused) keep it visible.
  const exitingIdle = leavingReader && session === null;
  // Fade the idle player in after the library→reader slide-in so it doesn't
  // snap in mid-transition. Mounts hidden because entering is set in the
  // provider's layout effect before the reader's registerBook passive effect.
  const enteringIdle = entering && session === null;
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
      registerDetailsOpener,
      registerViewer,
      unregisterViewer,
      startFromHere,
      syncViewerToPlayback,
      rehighlightCurrentChunk,
      openBookDetails,
      playPause,
      stop,
      scrub,
      setEngine,
      setVoice,
      jumpTo,
      pendingReaderSyncBookId,
      markPendingReaderSync,
      clearPendingReaderSync,
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
      registerDetailsOpener,
      registerViewer,
      unregisterViewer,
      startFromHere,
      syncViewerToPlayback,
      rehighlightCurrentChunk,
      openBookDetails,
      playPause,
      stop,
      scrub,
      setEngine,
      setVoice,
      jumpTo,
      pendingReaderSyncBookId,
      markPendingReaderSync,
      clearPendingReaderSync,
    ],
  );

  return (
    <AudioContext.Provider value={value}>
      {children}
      <audio ref={cloudAudioRef} className="hidden" />
      {showCard && (
        <div
          className={cn(
            "fixed bottom-12 left-12 z-[60] w-[calc(100%-6rem)] max-w-[640px] transition-opacity",
            (exitingIdle || enteringIdle) ? "duration-500" : "duration-300",
            (cardHidden || exitingIdle || enteringIdle) && "opacity-0 pointer-events-none",
          )}
        >
          <TtsPlayer
            variant="floating"
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
            bookCoverPath={session?.bookCoverPath ?? openBook?.bookCoverPath}
            bookId={session?.bookId ?? openBook?.bookId}
            canScrub={isCloud}
            playlist={session?.flatToc ?? (openBook ? buildSpinePlaylist(openBook.spineItems, openBook.toc) : undefined)}
            currentIndex={session?.currentIndex}
            onJumpTo={jumpTo}
            onOpenBookDetails={openBookDetails}
            onSyncToPlayback={syncViewerToPlayback}
            onMarkPendingReaderSync={markPendingReaderSync}
            hidden={cardHidden}
          />
        </div>
      )}
    </AudioContext.Provider>
  );
}
