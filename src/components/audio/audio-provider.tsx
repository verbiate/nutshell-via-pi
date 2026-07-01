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
} from "./audio-context";
import { buildSpinePlaylist, nextLeafFragmentInSameFile, findFlatSectionIndex } from "@/lib/reader/spine-playlist";
import { resolveAdvance, deriveGhost, type GhostItem } from "@/lib/reader/ghost";
import { TtsPlayer } from "@/components/reader/tts-player";
import { useSceneTransition } from "@/components/transitions/scene-transition";
import type { TtsPlaybackState } from "@/hooks/use-tts-playback";
import type { CloudQuota } from "@/hooks/use-tts-cloud";
import { useTtsEngine } from "@/hooks/use-tts-engine";
import { useTtsCloud } from "@/hooks/use-tts-cloud";
import {
  defaultEngineForLanguage,
  engineSupportsLanguage,
  type EngineId,
} from "@/lib/tts/languages";
import { ENGINES } from "@/lib/tts/engines";
import { loadTtsPref, saveTtsPref } from "@/lib/tts/pref";
import type { TtsVoice } from "@/lib/tts/types";
import { countWords, estimateSeconds, FALLBACK_WPM } from "@/lib/tts/estimate";
import { cn } from "@/lib/utils";
import { usePlaylist, usePlaylistMutations } from "@/hooks/use-playlist";
import { useSession } from "@/hooks/use-session";
import type { UserRole } from "@/types/book";
import type { PlaylistItem } from "@/types/playlist";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Play } from "lucide-react";

// ponytail: the three user-facing engine choices. cloud/browser aren't pickable
// here — cloud maps to "Premium", browser has no slot in the UI.
const ENGINE_OPTIONS: ReadonlyArray<{ id: EngineId; label: string }> = [
  { id: "kokoro", label: "Free (Highest Quality)" },
  { id: "supertonic", label: "Free (Faster)" },
  { id: "cloud", label: "Premium" },
];

function voiceLabel(v: TtsVoice): string {
  // ponytail: Kokoro English voices carry region (US/GB) → "Bella (US)".
  // Supertonic + non-en Kokoro have none → plain label. One rule covers both.
  return v.region ? `${v.label} (${v.region})` : v.label;
}

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
    readableEndSectionHref: ctx.readableEndSectionHref,
    readableStartSectionHref: ctx.readableStartSectionHref,
  };
}

interface AudioSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookLanguage: string;
  enginePref: EngineId;
  effectiveEngineId: EngineId;
  onEngineChange: (id: EngineId) => void;
  voicePref: string;
  onVoiceChange: (id: string) => void;
  voiceSpeed: number;
  onVoiceSpeedChange: (v: number) => void;
  userRole: UserRole;
  quota: CloudQuota | null;
  onTestVoice?: () => void;
}

export function AudioSettingsModal({
  open,
  onOpenChange,
  bookLanguage,
  enginePref,
  effectiveEngineId,
  onEngineChange,
  voicePref,
  onVoiceChange,
  voiceSpeed,
  onVoiceSpeedChange,
  userRole,
  quota,
  onTestVoice,
}: AudioSettingsModalProps) {
  // ponytail: voice catalog follows the *effective* engine so a WebGPU→browser
  // fallback refreshes the picker to browser voices. The engine radio + cloud
  // flag still track enginePref — browser isn't a selectable radio option and
  // cloud never falls back through this hook.
  const activeEngine = ENGINES[effectiveEngineId];
  const voices: TtsVoice[] = activeEngine?.getVoices(bookLanguage) ?? [];
  const isCloud = enginePref === "cloud";

  function disabledReason(id: EngineId): string | null {
    if (!engineSupportsLanguage(id, bookLanguage)) {
      return `Not available for ${bookLanguage || "this language"}`;
    }
    if (id === "cloud" && userRole === "regular") {
      return "Upgrade to Pro";
    }
    // ponytail: at-quota → same disabled surface as the role gate so users see
    // a single "Premium is off" message instead of a second bespoke state.
    if (id === "cloud" && quota && quota.limit > 0 && quota.used >= quota.limit) {
      return "Monthly limit reached";
    }
    return null;
  }

  // ponytail: badge copy. limit=0 reads as "no cloud access" (regular tier) —
  // surface the upgrade CTA rather than "0 / 0".
  const quotaBadge = (() => {
    if (!isCloud || !quota) return null;
    if (quota.limit <= 0) return "Premium: upgrade to Pro";
    return `${quota.used} / ${quota.limit} generations this month`;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Audio settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <TooltipProvider>
            <RadioGroup
              value={enginePref}
              onValueChange={(v) => onEngineChange(v as EngineId)}
              className="flex flex-col gap-2"
              aria-label="Text-to-speech engine"
            >
              {ENGINE_OPTIONS.map((opt) => {
                const reason = disabledReason(opt.id);
                const disabled = reason !== null;
                const radio = (
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <RadioGroupItem
                      value={opt.id}
                      id={`tts-eng-${opt.id}`}
                      disabled={disabled}
                      className="size-4"
                    />
                    <Label
                      htmlFor={`tts-eng-${opt.id}`}
                      className={cn(
                        "text-sm font-medium cursor-pointer",
                        disabled && "text-muted-foreground cursor-not-allowed",
                      )}
                    >
                      {opt.label}
                    </Label>
                  </span>
                );
                if (!disabled) return <span key={opt.id}>{radio}</span>;
                return (
                  <Tooltip key={opt.id}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">{radio}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top">{reason}</TooltipContent>
                  </Tooltip>
                );
              })}
            </RadioGroup>
          </TooltipProvider>

          {quotaBadge && (
            <span
              className="inline-block text-[11px] tabular-nums text-muted-foreground px-1.5 py-0.5 rounded border border-border bg-muted/40"
              title="Monthly Premium TTS generation quota"
            >
              {quotaBadge}
            </span>
          )}

          <Select value={isCloud ? "default" : voicePref} onValueChange={onVoiceChange}>
            <SelectTrigger size="sm" className="w-full" aria-label="Voice">
              <SelectValue placeholder="Voice" />
            </SelectTrigger>
            <SelectContent>
              {isCloud ? (
                <SelectItem value="default">Default voice</SelectItem>
              ) : voices.length === 0 ? (
                <SelectItem value="__none" disabled>
                  No voices
                </SelectItem>
              ) : (
                voices.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {voiceLabel(v)}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          {/* Reading speed */}
          <div className="flex flex-col gap-2">
            <Slider
              value={[voiceSpeed]}
              min={0.5}
              max={2}
              step={0.25}
              onValueChange={([v]) => onVoiceSpeedChange(v)}
              aria-label="Reading speed"
            />
            <div className="flex justify-between text-[10px] font-medium tabular-nums text-muted-foreground">
              <span>0.5×</span>
              <span className="text-center">REGULAR<br />SPEED</span>
              <span>1.25×</span>
              <span>1.5×</span>
              <span>2×</span>
            </div>
          </div>

          {onTestVoice && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={onTestVoice}
            >
              <Play className="h-3.5 w-3.5" />
              Test voice
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ponytail: section hrefs can carry a #fragment (or query) that differs
// between the rendition `rendered` event and the TOC href stored in
// sectionHrefRef. When BOTH sides carry a fragment, compare basename + "#" +
// fragment so verse-level entries (Analects) don't all collapse to one match.
// Otherwise fall back to basename compare so a path resolution mismatch
// (relative vs absolute, rendition-reported vs stored) doesn't false-negative.
function ttsSectionMatches(a: string, b: string): boolean {
  const strip = (h: string) => h.split("?")[0].trim();
  const pa = strip(a);
  const pb = strip(b);
  const fa = pa.indexOf("#");
  const fb = pb.indexOf("#");
  const base = (h: string) => h.split("#")[0].split("/").pop() ?? h;
  if (fa >= 0 && fb >= 0) {
    return base(pa) === base(pb) && pa.slice(fa) === pb.slice(fb);
  }
  return base(pa) === base(pb);
}

/**
 * When `href` carries a #fragment, TTS text is already bounded to that verse
 * (extractSectionText / viewer.getSectionText both honor the fragment), so a
 * `startPos.elementId` equal to the fragment would compute an offset against
 * the whole-file DOM and land past the end of the bounded text. Drop elementId
 * in that case; keep passage-level `useVisible` / `startCfi` (independent of
 * the fragment).
 */
function normalizeStartPos(
  href: string,
  startPos?: { elementId?: string; useVisible?: boolean; startCfi?: string },
): { elementId?: string; useVisible?: boolean; startCfi?: string } | undefined {
  if (!startPos) return undefined;
  const fragIdx = href.indexOf("#");
  if (fragIdx < 0) return startPos;
  const fragment = href.slice(fragIdx + 1);
  if (startPos.elementId && startPos.elementId === fragment) {
    const { elementId: _drop, ...rest } = startPos;
    // ponytail: if nothing else is set, return undefined so the engine starts
    // at chunk 0 of the bounded text.
    return rest.useVisible || rest.startCfi ? rest : undefined;
  }
  return startPos;
}

export function AudioProvider({ children }: { children: React.ReactNode }) {
  // ponytail: engine/voice/speed prefs are global to the app session, not per-book.
  const [enginePref, setEnginePref] = useState<EngineId>(() =>
    defaultEngineForLanguage("en"),
  );
  const [voicePref, setVoicePref] = useState<string>("");
  const [voiceSpeed, setVoiceSpeedState] = useState<number>(1);

  // Unified Audio Settings modal — opened from the TtsPlayer gear icon AND
  // the Book Settings sidebar. Single owner means a single open/close path.
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const openAudioSettings = useCallback(() => setAudioSettingsOpen(true), []);
  const closeAudioSettings = useCallback(() => setAudioSettingsOpen(false), []);
  const { leavingReader, entering } = useSceneTransition();
  const { user } = useSession();

  // The currently open book (reader mounted) and the active playback session
  // (may be a different book when the user keeps audio playing while browsing).
  const [openBook, setOpenBook] = useState<BookAudioContext | null>(null);
  const [session, setSession] = useState<AudioSession | null>(null);

  // User playlist (persisted): empty by default; active item drives the playhead.
  const { items: playlistItems, autoAdvanceBook } = usePlaylist();
  const playlistMutations = usePlaylistMutations();

  const activeItem = useMemo(
    () => playlistItems.find((i) => i.status === "active") ?? null,
    [playlistItems],
  );

  // ponytail: one-shot flag set by the floating player's thumbnail click when
  // the user is off-reader, so the reader syncs to the TTS position on mount
  // even if playback is paused (the normal auto-sync only fires while PLAYING).
  const [pendingReaderSyncBookId, setPendingReaderSyncBookId] = useState<
    string | null
  >(null);

  // ponytail: end-of-book signal — set when the last flat-toc section finishes
  // and cleared on any new playback. Rendered as a "Book finished" label + an
  // inert heart in place of the play button. Separate from playback state
  // (which is IDLE while the heart shows) so existing IDLE/ENDED branches stay
  // unchanged.
  const [bookFinished, setBookFinished] = useState(false);

  // Ref mirrors for stable callbacks wired to audio events.
  const openBookRef = useRef(openBook);
  const sessionRef = useRef(session);
  const activeItemRef = useRef(activeItem);
  const playlistItemsRef = useRef(playlistItems);
  const autoAdvanceRef = useRef(autoAdvanceBook);
  const bookFinishedRef = useRef(bookFinished);
  useEffect(() => {
    openBookRef.current = openBook;
  }, [openBook]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    activeItemRef.current = activeItem;
  }, [activeItem]);
  useEffect(() => {
    playlistItemsRef.current = playlistItems;
  }, [playlistItems]);
  useEffect(() => {
    autoAdvanceRef.current = autoAdvanceBook;
  }, [autoAdvanceBook]);
  useEffect(() => {
    bookFinishedRef.current = bookFinished;
  }, [bookFinished]);

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

  // ponytail: hydrate saved engine/voice/speed once at app start. Runs in useEffect
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
    if (typeof saved.speed === "number" && saved.speed >= 0.5 && saved.speed <= 2) {
      setVoiceSpeedState(saved.speed);
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
    saveTtsPref("en", { engineId: enginePref, voiceId: voicePref, speed: voiceSpeed });
  }, [enginePref, voicePref, voiceSpeed]);

  const setVoiceSpeed = useCallback((speed: number) => {
    // ponytail: clamp at the boundary so the slider can pass raw values and
    // every consumer reads a clean 0.5–2 number.
    const clamped = Math.min(2, Math.max(0.5, speed));
    setVoiceSpeedState(clamped);
  }, []);

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

  // Keep the in-memory audio session aligned with the persisted active playlist
  // item so percentage calc, cloud toc, and highlight-follow-along all agree.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!activeItem) return;
    // ponytail: text tracks (discussion replies) carry no book context — they
    // don't participate in session/flatToc alignment.
    if (activeItem.kind === "text") return;

    // Fast path: the open reader IS the active item's book. (Re)build the
    // session from openBook — this refreshes flatToc + metadata + readable
    // bounds as they populate async (spine/toc/cover load after first mount),
    // and is the only path that introduces a NEW book into the session.
    if (openBook && openBook.bookId === activeItem.bookId) {
      const flatToc = buildSpinePlaylist(openBook.spineItems, openBook.toc);
      // ponytail: fragment-aware lookup — a bare parent (Blitzscaling "Part I")
      // and its fragment children share a basename, so basename-only matching
      // would pin currentIndex to the parent and make "Next" restart the
      // current child. findFlatSectionIndex prefers an exact basename+fragment
      // match, falling back to basename-only for path-prefix resilience.
      const idx = findFlatSectionIndex(flatToc, activeItem.sectionHref ?? "");
      const currentIndex = Math.max(0, idx);
      setSession((prev) => {
        if (!prev || prev.bookId !== activeItem.bookId) {
          return createSession(openBook, currentIndex);
        }
        // ponytail: refresh flatToc AND book metadata (title/author/cover/language)
        // from openBook. spine/toc/cover all populate asynchronously after first
        // mount — a session created while they were empty keeps stale values
        // forever on same-bookId updates, surfacing as:
        //   - flatToc=[]:   "no section at currentIndex" → syncViewerToPlayback no-op
        //   - bookCoverPath=null: placeholder thumbnail in the player card
        // Bail only when currentIndex, flatToc length, AND book metadata are all
        // unchanged (cheap proxy for "openBook hasn't meaningfully changed").
        const bookMetaChanged =
          prev.bookCoverPath !== openBook.bookCoverPath ||
          prev.bookTitle !== openBook.bookTitle ||
          prev.bookAuthor !== openBook.bookAuthor ||
          prev.bookLanguage !== openBook.bookLanguage ||
          prev.readableEndSectionHref !== openBook.readableEndSectionHref ||
          prev.readableStartSectionHref !== openBook.readableStartSectionHref;
        if (
          prev.currentIndex === currentIndex &&
          prev.flatToc.length === flatToc.length &&
          !bookMetaChanged
        ) {
          return prev;
        }
        return {
          ...prev,
          currentIndex,
          flatToc,
          bookCoverPath: openBook.bookCoverPath,
          bookTitle: openBook.bookTitle,
          bookAuthor: openBook.bookAuthor,
          bookLanguage: openBook.bookLanguage,
          readableEndSectionHref: openBook.readableEndSectionHref,
          readableStartSectionHref: openBook.readableStartSectionHref,
        };
      });
      return;
    }

    // Cross-book path: the user is browsing a different reader than the active
    // item's book (openBook = Book 2, active item = Book 1). Keep the session's
    // book context (flatToc + readable bounds, captured when Book 1's reader
    // was open) but re-sync the playhead to the active item so ghost derivation
    // and section advancement stay correct. Without this, currentIndex drifts
    // behind every ghost promotion — both updaters used to bail on the book
    // mismatch, so the ghost resolved to the wrong (often current) section and
    // clicking it duplicated it ("now playing Part III; next up Part III").
    setSession((prev) => {
      if (!prev || prev.bookId !== activeItem.bookId) {
        // Active item's book is neither open nor the session's book, and there
        // is no by-bookId spine endpoint. Playback still works (getText fetches
        // section text by bookId), but the ghost can't compute without the
        // spine — it stays null until that book's reader is opened.
        return prev;
      }
      const idx = findFlatSectionIndex(prev.flatToc, activeItem.sectionHref ?? "");
      const currentIndex = Math.max(0, idx);
      if (prev.currentIndex === currentIndex) return prev;
      return { ...prev, currentIndex };
    });
  }, [activeItem, openBook]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ─── Text source strategy ──────────────────────────────────────────────────
  // In-reader: prefer the live iframe (no navigation if already on section);
  // off-reader / playlist jumps: fetch from the server endpoint.
  const getText = useCallback(
    async (href: string, bookIdOverride?: string): Promise<string> => {
      // ponytail: prefer the caller-provided bookId (the caller always knows
      // which book the href belongs to). The session/openBook refs are stale
      // during a book switch (e.g. clicking a queued item from another book),
      // and guessing from them sends the wrong bookId to the server → 404.
      const bookId =
        bookIdOverride ??
        sessionRef.current?.bookId ??
        openBookRef.current?.bookId;
      if (!bookId) return "";

    const viewer = registeredViewerRef.current?.current;
    const currentHref = openBookRef.current?.currentHref;

    // ponytail: only use the live viewer when it belongs to the book we're
    // playing. When the user is browsing a different book's reader than the
    // active session (openBook = Book 2, session = Book 1), the registered
    // viewer is Book 2's rendition — feeding it Book 1's href navigates to a
    // missing section ("No Section Found") and getSectionText() silently
    // returns Book 2's page. Fall through to the server fetch below, which
    // uses `bookId` (the session's book). Mirrors the guards in
    // syncViewerToPlayback and rehighlightCurrentChunk.
    if (viewer && openBookRef.current?.bookId === bookId) {
      // ponytail: split the #fragment off. Navigation is per-file (basename);
      // two verses in the same file share currentHref, so compare basenames
      // and only navigate when the FILE differs. The fragment is passed to
      // getSectionText so TTS reads one verse, not the whole file.
      const fragIdx = href.indexOf("#");
      const fragment = fragIdx >= 0 ? href.slice(fragIdx + 1) : undefined;
      const hrefPath = fragIdx >= 0 ? href.slice(0, fragIdx) : href;
      const currentPath = currentHref?.split("#")[0] ?? "";
      const sameBase = ttsSectionMatches(hrefPath, currentPath);
      if (!sameBase) {
        await viewer.navigateTo(href, { ttsNav: true });
      }
      // ponytail: bound the section's range at the NEXT ToC leaf in the same
      // file, not the next DOM id'd element. EPUBs sometimes carry sub-section
      // ids absent from the ToC (Blitzscaling s16/s17/s18 under s15) — DOM
      // auto-discovery would truncate the section to its intro paragraph. This
      // also bounds bare-href structural parents (Blitzscaling "Part I") at
      // their first fragment child, so the parent reads only its intro.
      // Session flatToc is the live playlist; fall back to building from
      // openBook when the session isn't established yet.
      const flatToc =
        sessionRef.current?.flatToc ??
        (openBookRef.current
          ? buildSpinePlaylist(openBookRef.current.spineItems, openBookRef.current.toc)
          : []);
      // ponytail: unconditional — nextLeafFragmentInSameFile returns undefined
      // when the next leaf is in a different file, so plain bare-href chapters
      // (no fragment siblings) keep their DOM-fallback behavior unchanged.
      const endFragment = nextLeafFragmentInSameFile(flatToc, href);
      const txt = viewer.getSectionText(fragment, endFragment) ?? "";
      return txt;
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

  // ponytail: mirror registeredViewer into a ref so scheduleTtsPosSave (stable
  // callback) can read the current mount state without rebuilding on every
  // register/unregister.
  const registeredViewerRef = useRef(registeredViewer);
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    registeredViewerRef.current = registeredViewer;
  }, [registeredViewer]);
  /* eslint-enable react-hooks/immutability */

  // ─── TTS read-aloud position persistence ────────────────────────────────────
  const ttsPosPendingRef = useRef<{
    bookId: string;
    sectionHref: string;
    ttsChunkAnchor?: string;
  } | null>(null);
  const ttsPosTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushTtsPosSave = useCallback(() => {
    if (ttsPosTimerRef.current) {
      clearTimeout(ttsPosTimerRef.current);
      ttsPosTimerRef.current = null;
    }
    const pending = ttsPosPendingRef.current;
    ttsPosPendingRef.current = null;
    if (!pending) return;
    const cfi =
      registeredViewerRef.current?.current?.getCurrentCfi() ?? undefined;
    const flatToc = sessionRef.current?.flatToc ?? [];
    let percentage: number | undefined;
    if (flatToc.length > 0) {
      const idx = flatToc.findIndex((s) => s.href === pending.sectionHref);
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
    }).catch(() => {});
  }, []);

  const scheduleTtsPosSave = useCallback(
    (info: { sectionHref: string; ttsChunkAnchor?: string }) => {
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

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushTtsPosSave();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flushTtsPosSave]);

  // ─── Core playback helpers (must be defined before hooks that consume them) ─
  const startSection = useCallback(
    (
      href: string,
      title: string,
      startPos?: { elementId?: string; useVisible?: boolean; startCfi?: string },
      bookId?: string,
    ) => {
      setBookFinished(false);
      const s = sessionRef.current;
      const isCloudNow = enginePref === "cloud" && s?.userRole !== "regular";
      if (isCloudNow) {
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
        cloudTtsRef.current?.startSection(href, title, { seekRatio }, bookId);
      } else {
        browserTtsRef.current?.startSection(href, title, startPos, bookId);
      }
      scheduleTtsPosSave({ sectionHref: href });
    },
    [enginePref, scheduleTtsPosSave],
  );

  // ponytail: speak arbitrary text (a discussion reply). Same cloud/browser
  // routing as startSection. No session/viewer coupling — text is self-contained.
  const startText = useCallback(
    (text: string, title: string) => {
      setBookFinished(false);
      const s = sessionRef.current;
      const isCloudNow = enginePref === "cloud" && s?.userRole !== "regular";
      if (isCloudNow) {
        cloudTtsRef.current?.startText(text, title);
      } else {
        browserTtsRef.current?.startText(text, title);
      }
    },
    [enginePref],
  );

  // ponytail: start playback for whichever playlist item is active, branching
  // on kind. Section items use the viewer-coupled startSection path; text items
  // use startText. Used by resume/jump/advance paths so they don't need to know
  // the item's kind at every call site.
  const startActiveItem = useCallback(
    (item: PlaylistItem) => {
      if (item.kind === "text") {
        startText(item.text ?? "", item.sectionLabel ?? "Reading");
      } else {
        startSection(
          item.sectionHref ?? "",
          item.sectionLabel ?? "",
          undefined,
          item.bookId ?? undefined,
        );
      }
    },
    [startSection, startText],
  );

  // ponytail: shared terminal-state transition — close the active engine,
  // drop the session, and raise the "Book finished" flag. Used by both the
  // readable-end stop and the end-of-flat-toc stop in handleSectionComplete
  // (2 callers — extract-at-2 because the bodies are byte-identical and the
  // intent is the same; if a 3rd terminal state appears, this is the seam).
  const markBookFinished = useCallback(
    (s: AudioSession) => {
      if (enginePref === "cloud" && s.userRole !== "regular") {
        cloudTtsRef.current?.close();
      } else {
        browserTtsRef.current?.close();
      }
      setSession(null);
      setBookFinished(true);
    },
    [enginePref],
  );

  const handleSectionComplete = useCallback(async () => {
    const active = activeItemRef.current;
    if (!active) return;

    // ponytail: text tracks (discussion replies) have no book session, so the
    // !s bail below would skip them — handle them FIRST. Advance to the next
    // queued item if any; else no-op (the engine already set ENDED; "book
    // finished" doesn't apply to a reply).
    if (active.kind === "text") {
      const next =
        playlistItemsRef.current.find(
          (i) => i.position === active.position + 1,
        ) ?? null;
      if (next) {
        await playlistMutations.activateItem(next.id);
        startActiveItem(next);
      }
      return;
    }

    const s = sessionRef.current;
    if (!s) return;

    const ghost = deriveGhost(
      autoAdvanceRef.current,
      s,
      active,
      ttsSectionMatches,
    );
    const manualNext =
      playlistItemsRef.current.find(
        (i) => i.position === active.position + 1,
      ) ?? null;
    const atReadableEnd =
      !!s.readableEndSectionHref &&
      ttsSectionMatches(active.sectionHref ?? "", s.readableEndSectionHref);
    const atEndOfToc = s.currentIndex + 1 >= s.flatToc.length;

    const decision = resolveAdvance({
      ghostItem: ghost,
      manualNext,
      atReadableEnd,
      atEndOfToc,
    });

    switch (decision.kind) {
      case "ghost": {
        // ponytail: single atomic promote (insert-as-active after the current
        // active, demote old active, preserve the queue) — replaces the old
        // addItem(mode:"last") + activateItem two-step, which both flashed an
        // intermediate "upcoming" row AND wiped the manual queue (activateItem
        // marks everything before the end-positioned row as history).
        await playlistMutations.promoteItem({
          bookId: s.bookId,
          sectionHref: decision.ghost.sectionHref,
          sectionLabel: decision.ghost.sectionLabel,
          bookTitle: s.bookTitle,
          bookAuthor: s.bookAuthor,
          bookCoverPath: s.bookCoverPath,
          bookLanguage: s.bookLanguage,
        });
        startSection(decision.ghost.sectionHref, decision.ghost.sectionLabel, undefined, s.bookId);
        return;
      }
      case "manual": {
        await playlistMutations.activateItem(decision.item.id);
        startActiveItem(decision.item);
        return;
      }
      case "terminal": {
        // ponytail: nothing left to play (readable-end pinned or end of TOC) -
        // close the session and mark finished. Hoisted above the auto-advance
        // branch so finishing the last cued section doesn't strand the engine
        // IDLE with a stale "Start reading from here" card.
        markBookFinished(s);
        return;
      }
      case "idle":
        return;
    }
  }, [markBookFinished, playlistMutations, startSection, startActiveItem]);

  // ponytail: explicit "next" intent - skip button OR ghost-click OR ENDED-card
  // tap. Same ghost-first precedence as handleSectionComplete; terminal is a
  // no-op here rather than markBookFinished (the click is user-driven).
  const advanceToNextSection = useCallback(async () => {
    const active = activeItemRef.current;

    // ponytail: text tracks — no session/ghost/readable-end. Handle BEFORE the
    // !s bail (text tracks have no session). Advance to next or no-op.
    if (active && active.kind === "text") {
      const next =
        playlistItemsRef.current.find(
          (i) => i.position === active.position + 1,
        ) ?? null;
      if (next) {
        await playlistMutations.activateItem(next.id);
        startActiveItem(next);
      }
      return;
    }

    const s = sessionRef.current;
    if (!s) return;

    // ponytail: explicit "Play next section" click must advance regardless of
    // the auto-advance toggle — that toggle only gates automatic advancement
    // at section end (handleSectionComplete). Pass true so deriveGhost honors
    // the user's explicit intent instead of no-op'ing when autoplay is off.
    const ghost = active
      ? deriveGhost(true, s, active, ttsSectionMatches)
      : null;
    const manualNext = active
      ? (playlistItemsRef.current.find(
          (i) => i.position === active.position + 1,
        ) ?? null)
      : null;
    const atReadableEnd =
      !!active &&
      !!s.readableEndSectionHref &&
      ttsSectionMatches(active.sectionHref ?? "", s.readableEndSectionHref);
    const atEndOfToc = s.currentIndex + 1 >= s.flatToc.length;

    const decision = resolveAdvance({
      ghostItem: ghost,
      manualNext,
      atReadableEnd,
      atEndOfToc,
    });

    switch (decision.kind) {
      case "ghost": {
        // ponytail: single atomic promote (insert-as-active after the current
        // active, demote old active, preserve the queue) — replaces the old
        // addItem(mode:"last") + activateItem two-step, which both flashed an
        // intermediate "upcoming" row AND wiped the manual queue (activateItem
        // marks everything before the end-positioned row as history).
        await playlistMutations.promoteItem({
          bookId: s.bookId,
          sectionHref: decision.ghost.sectionHref,
          sectionLabel: decision.ghost.sectionLabel,
          bookTitle: s.bookTitle,
          bookAuthor: s.bookAuthor,
          bookCoverPath: s.bookCoverPath,
          bookLanguage: s.bookLanguage,
        });
        startSection(decision.ghost.sectionHref, decision.ghost.sectionLabel, undefined, s.bookId);
        return;
      }
      case "manual": {
        await playlistMutations.activateItem(decision.item.id);
        startActiveItem(decision.item);
        return;
      }
      case "terminal":
        return;
      case "idle":
        return;
    }
  }, [playlistMutations, startSection, startActiveItem]);

  // ─── TTS engine hooks ──────────────────────────────────────────────────────
  const browserTts = useTtsEngine({
    bookId: session?.bookId ?? "",
    bookLanguage: session?.bookLanguage ?? "en",
    getText,
    viewerRef: registeredViewer ?? undefined,
    engineId: enginePref,
    voiceId: voicePref,
    speed: voiceSpeed,
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

  useEffect(() => {
    browserTtsRef.current = browserTts;
    cloudTtsRef.current = cloudTts;
  });

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
            words > 0 ? estimateSeconds(words, FALLBACK_WPM, voiceSpeed) : 0,
          );
        })
      .catch(() => {
        if (!cancelled) setCloudGenEstimate(0);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePref, cloudTts.state, getText]); // eslint-disable-line react-hooks/exhaustive-deps -- voiceSpeed is a snapshot at generation start; mid-generation speed changes shouldn't recompute the estimate

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

  // ponytail: ref mirror so handlePlayPause (stable, in deps of TtsPlayer) can
  // read the current phase without rebuilding on every timeupdate — keeps the
  // floating card from re-rendering every 250ms.
  const playbackStateRef = useRef(playbackState);
  useEffect(() => {
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  // ponytail: mirror isCloud into a ref so playPause can read the active engine
  // routing without depending on the session. Text tracks (kind="text") never
  // create a session, so the old `if (!s) return` bail left them unable to
  // pause/resume. isCloud is already null-safe (undefined !== "regular" →
  // collapses to enginePref === "cloud", correct since regular users can't
  // pick cloud). If that assumption ever breaks, switch to explicit
  // activeEngineKindRef tracking set by startText/startSection.
  const isCloudRef = useRef(isCloud);
  useEffect(() => {
    isCloudRef.current = isCloud;
  }, [isCloud]);

  // ─── Cloud audio playback speed ────────────────────────────────────────────
  useEffect(() => {
    if (cloudAudioRef.current) {
      cloudAudioRef.current.playbackRate = voiceSpeed;
    }
  }, [voiceSpeed, cloudAudioRef, cloudTts.state.state]);

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const ensureSessionForItem = useCallback((item: PlaylistItem) => {
    // ponytail: text tracks need no book session (no flatToc/viewer/highlight).
    if (item.kind === "text") return;
    const open = openBookRef.current;
    if (!open || open.bookId !== item.bookId) return;
    const flatToc = buildSpinePlaylist(open.spineItems, open.toc);
    const idx = findFlatSectionIndex(flatToc, item.sectionHref ?? "");
    const currentIndex = Math.max(0, idx);
    setSession((prev) => {
      if (!prev) return createSession(open, currentIndex);
      if (prev.bookId !== item.bookId) return createSession(open, currentIndex);
      // ponytail: refresh flatToc AND book metadata — see the activeItem effect
      // above for why. A session built before spine/toc/cover populate keeps
      // stale values forever on same-bookId updates.
      const bookMetaChanged =
        prev.bookCoverPath !== open.bookCoverPath ||
        prev.bookTitle !== open.bookTitle ||
        prev.bookAuthor !== open.bookAuthor ||
        prev.bookLanguage !== open.bookLanguage;
      if (
        prev.currentIndex === currentIndex &&
        prev.flatToc.length === flatToc.length &&
        !bookMetaChanged
      ) {
        return prev;
      }
      return {
        ...prev,
        currentIndex,
        flatToc,
        bookCoverPath: open.bookCoverPath,
        bookTitle: open.bookTitle,
        bookAuthor: open.bookAuthor,
        bookLanguage: open.bookLanguage,
      };
    });
  }, []);

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
    // ponytail: do NOT bail on a null session — text tracks (kind="text") never
    // create one, and pause/resume must still work for them (e.g. a discussion
    // reply playing on the Bookshelf). The session is only needed for the
    // book-section "what do I start?" fallback in the IDLE/ENDED branch below.
    const isCloudNow = isCloudRef.current;
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
      const active = activeItemRef.current;
      if (active) {
        startActiveItem(active);
        return;
      }
      // Book-section fallback: resume the session's current section. Text
      // tracks have no session and are handled by the active branch above.
      const s = sessionRef.current;
      const section = s?.flatToc[s.currentIndex];
      if (section && s) {
        browserTts.startSection(section.href, section.label, undefined, s.bookId);
      }
    }
  }, [browserTts, cloudTts, startActiveItem]);

  const playSection = useCallback(
    async (
      bookId: string,
      href: string,
      label: string,
      mode: "now" | "next" | "last",
      startPos?: { elementId?: string; useVisible?: boolean; startCfi?: string },
      bookMeta?: {
        bookTitle?: string;
        bookAuthor?: string | null;
        bookCoverPath?: string | null;
        bookLanguage?: string;
      },
    ) => {
      if (mode !== "now") {
        await playlistMutations.addItem({
          bookId,
          sectionHref: href,
          sectionLabel: label,
          mode,
          ...bookMeta,
        });
        return;
      }

      const active = activeItemRef.current;
      const isSameActive =
        active &&
        active.kind === "section" &&
        active.bookId === bookId &&
        !!active.sectionHref &&
        ttsSectionMatches(active.sectionHref, href);
      if (isSameActive && active) {
        if (!startPos) {
          playPause();
        } else {
          // ponytail: re-resume the same active item at a specific position
          // (e.g. "Start reading from here" on the visible page of a section
          // already in the playlist). Re-activate in place instead of adding a
          // duplicate "next" entry.
          await playlistMutations.activateItem(active.id);
          ensureSessionForItem(active);
          startSection(href, label, normalizeStartPos(href, startPos), bookId);
        }
        return;
      }

      const addMode = active ? "next" : "last";
      // ponytail: navigate the viewer to the target section BEFORE starting TTS
      // so highlight-follow-along has rendered DOM to mark when chunk 0 plays.
      // Without this, highlightChunk fires before the new section is in the
      // iframe → no marks (audio plays, highlight missing). Skip only when the
      // FILE is already current AND there's no #fragment — a fragment needs
      // display(fragmentHref) to paginate to the verse's CFI (the reliable
      // page-jump on "Play now"), even within the same file.
      const viewer = registeredViewerRef.current?.current;
      const currentHref = openBookRef.current?.currentHref;
      const hasFragment = href.includes("#");
      const sameFile = ttsSectionMatches(currentHref ?? "", href);
      if (viewer && (!sameFile || hasFragment)) {
        await viewer.navigateTo(href, { ttsNav: true }).catch(() => {});
      }
      const item = await playlistMutations.addItem({
        bookId,
        sectionHref: href,
        sectionLabel: label,
        mode: addMode,
        ...bookMeta,
      });
      await playlistMutations.activateItem(item.id);
      ensureSessionForItem(item);
      startSection(href, label, normalizeStartPos(href, startPos), bookId);
    },
    [playlistMutations, playPause, startSection, ensureSessionForItem],
  );

  // ponytail: play arbitrary text (a discussion reply). Mirrors playSection's
  // mode semantics: now = interrupt + play; next/last = queue without playing.
  // Text tracks carry no book reference, so no viewer navigation or access check.
  const playText = useCallback(
    async (
      text: string,
      label: string,
      mode: "now" | "next" | "last",
    ) => {
      if (mode !== "now") {
        await playlistMutations.addItem({
          kind: "text",
          text,
          sectionLabel: label,
          mode,
        });
        return;
      }

      const active = activeItemRef.current;
      // Same active text reply → toggle/resume instead of re-queueing a dupe.
      if (active && active.kind === "text" && active.text === text) {
        playPause();
        return;
      }

      const addMode = active ? "next" : "last";
      const item = await playlistMutations.addItem({
        kind: "text",
        text,
        sectionLabel: label,
        mode: addMode,
      });
      await playlistMutations.activateItem(item.id);
      startText(text, label);
    },
    [playlistMutations, playPause, startText],
  );

  const startFromHere = useCallback(
    async (
      overrideHref?: string,
      overrideLabel?: string,
      startPos?: { elementId?: string; useVisible?: boolean; startCfi?: string },
    ) => {
      const open = openBookRef.current;
      if (!open) return;

      const href = overrideHref ?? open.currentHref;
      const flatToc = buildSpinePlaylist(open.spineItems, open.toc);
      // ponytail: fragment-aware lookup keeps the "Read aloud from here" label
      // pinned to the actual fragment child, not the bare parent that shares
      // its basename (see findFlatSectionIndex).
      const currentFlat = flatToc[findFlatSectionIndex(flatToc, href)];
      const title =
        overrideLabel || currentFlat?.label || open.bookTitle || "Reading";

      if (overrideHref) {
        await registeredViewerRef.current?.current
          ?.navigateTo(href, { ttsNav: true })
          .catch(() => {});
      }

      await playSection(open.bookId, href, title, "now", startPos, {
        bookTitle: open.bookTitle,
        bookAuthor: open.bookAuthor,
        bookCoverPath: open.bookCoverPath,
        bookLanguage: open.bookLanguage,
      });
    },
    [playSection],
  );

  const handlePlayPause = useCallback(() => {
    // ponytail: end-of-book — heart is decorative. Ignore further plays.
    if (bookFinishedRef.current) return;

    // ponytail: route IDLE/ENDED explicitly to the semantics the UI advertises
    // (vs. the old no-session + active-item branch which restarted the section
    // from its beginning). IDLE on-reader → "Start reading from here" reads
    // from the top of the visible page; ENDED → "Play next section" advances.
    const ps = playbackStateRef.current.state;
    if (ps === "IDLE") {
      const open = openBookRef.current;
      if (open) {
        startFromHere(undefined, undefined, { useVisible: true });
        return;
      }
      // Off-reader IDLE (no visible page): resume the active playlist item if
      // any, else nothing to do.
      const active = activeItemRef.current;
      if (active) {
        ensureSessionForItem(active);
        startActiveItem(active);
      }
      return;
    }
    if (ps === "ENDED") {
      void advanceToNextSection();
      return;
    }
    playPause();
  }, [playPause, startFromHere, startActiveItem, ensureSessionForItem, advanceToNextSection]);

  const stop = useCallback(() => {
    const s = sessionRef.current;
    const isCloudNow = enginePref === "cloud" && s?.userRole !== "regular";
    if (isCloudNow) {
      cloudTts.close();
    } else {
      browserTts.close();
    }
    flushTtsPosSave();
    setSession(null);
    setBookFinished(false);
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

  const jumpToItem = useCallback(
    async (itemId: string) => {
      const item = playlistItemsRef.current.find((i) => i.id === itemId);
      if (!item) return;
      await playlistMutations.activateItem(itemId);
      ensureSessionForItem(item);
      startActiveItem(item);
    },
    [playlistMutations, startActiveItem, ensureSessionForItem],
  );

  const jumpTo = useCallback(
    async (index: number) => {
      const s = sessionRef.current;
      if (!s) return;
      const section = s.flatToc[index];
      if (!section) return;
      const existing = playlistItemsRef.current.find((i) =>
        ttsSectionMatches(i.sectionHref ?? "", section.href),
      );
      if (existing) {
        await jumpToItem(existing.id);
      } else {
        await playSection(
          s.bookId,
          section.href,
          section.label,
          "now",
          undefined,
          {
            bookTitle: s.bookTitle,
            bookAuthor: s.bookAuthor,
            bookCoverPath: s.bookCoverPath,
            bookLanguage: s.bookLanguage,
          },
        );
      }
    },
    [jumpToItem, playSection],
  );

  const removePlaylistItem = useCallback(
    async (itemId: string) => {
      await playlistMutations.removeItem(itemId);
    },
    [playlistMutations],
  );

  const clearPlaylist = useCallback(
    async (scope: "all" | "upcoming") => {
      if (scope === "all") {
        stop();
      }
      await playlistMutations.clear(scope);
    },
    [playlistMutations, stop],
  );

  const reorderPlaylist = useCallback(
    async (orderedIds: string[]) => {
      await playlistMutations.reorder(orderedIds);
    },
    [playlistMutations],
  );

  const setAutoAdvanceBook = useCallback(
    async (value: boolean) => {
      await playlistMutations.setAutoAdvance(value);
    },
    [playlistMutations],
  );

  const syncViewerToPlayback = useCallback(async (): Promise<boolean> => {
    const s = sessionRef.current;
    const viewer = registeredViewerRef.current?.current;
    if (!s || !viewer) {
      console.warn("[syncViewerToPlayback] no-op: missing session/viewer", {
        hasSession: !!s,
        hasViewer: !!viewer,
      });
      return false;
    }
    if (openBookRef.current?.bookId !== s.bookId) {
      console.warn("[syncViewerToPlayback] no-op: book mismatch", {
        openBookId: openBookRef.current?.bookId,
        sessionBookId: s.bookId,
      });
      return false;
    }
    const section = s.flatToc[s.currentIndex];
    if (!section) {
      console.warn("[syncViewerToPlayback] no-op: no section at currentIndex", {
        currentIndex: s.currentIndex,
        flatTocLen: s.flatToc.length,
      });
      return false;
    }

    const onSection = ttsSectionMatches(
      openBookRef.current?.currentHref ?? "",
      section.href,
    );
    console.log("[syncViewerToPlayback] entering", {
      onSection,
      readerHref: openBookRef.current?.currentHref,
      ttsSectionHref: section.href,
    });
    if (!onSection) {
      try {
        await viewer.navigateTo(section.href, { ttsNav: true });
      } catch (err) {
        console.warn("[syncViewerToPlayback] nav failed:", err);
        return false;
      }
      await viewer.waitForRender();
    } else {
      viewer.clearTtsHighlight();
    }

    const chunk = browserTtsRef.current?.getCurrentChunk();
    if (!chunk?.chunkText) {
      // ponytail: diagnostic — this is the silent-success path that produces
      // the "click thumbnail → nothing happens" symptom. Section nav above
      // may have already happened; if onSection was true, NOTHING visible
      // occurred. Log so we can pin why chunk state is empty during what
      // should be active playback.
      console.warn(
        "[syncViewerToPlayback] no chunk to highlight — silent return",
        {
          hasBrowserTts: !!browserTtsRef.current,
          chunkSectionHref: chunk?.sectionHref ?? null,
        },
      );
      return true;
    }
    try {
      await viewer.highlightChunk(chunk.chunkText, { force: true });
      console.log("[syncViewerToPlayback] ok", {
        chunkLen: chunk.chunkText.length,
      });
      return true;
    } catch (err) {
      console.warn("[syncViewerToPlayback] highlight failed:", err);
      return false;
    }
  }, []);

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
    if (!viewer.hasChunkText(chunk.chunkText)) return;
    try {
      await viewer.clearTtsHighlight();
      await viewer.highlightChunk(chunk.chunkText);
    } catch {}
  }, []);

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
  const cardHidden = readerControlsHidden && !isActivelyPlaying;
  const exitingIdle = leavingReader && session === null;
  const enteringIdle = entering && session === null;
  const showCard =
    !!openBook || session !== null || playlistItems.length > 0;

  // ponytail: ghost = next readable section of the active item's book.
  // Pure function of (session + active item + toggle); recomputed on every
  // activation, held while active. Null when toggle off, no session, the
  // active item belongs to another book, or the readable window is exhausted.
  // Handlers re-derive the same value from refs (autoAdvanceRef) so their
  // callback identity stays stable across ghost changes.
  const ghostItem: GhostItem | null = useMemo(
    () => deriveGhost(autoAdvanceBook, session, activeItem, ttsSectionMatches),
    [autoAdvanceBook, session, activeItem],
  );

  // ponytail: skip-ahead affordance. Visible whenever playback is non-IDLE and
  // there's somewhere to skip *to*: the ghost, or an upcoming playlist item
  // ahead of the active one.
  const activePos = activeItem?.position;
  const hasNextUpcoming = playlistItems.some(
    (i) => i.status === "upcoming" && activePos != null && i.position > activePos,
  );
  const canSkipAhead =
    playbackState.state !== "IDLE" && (ghostItem != null || hasNextUpcoming);

  // ─── Context value ─────────────────────────────────────────────────────────
  const value: AudioContextValue = useMemo(
    () => ({
      session,
      openBookId: openBook?.bookId ?? null,
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
      syncViewerToPlayback,
      rehighlightCurrentChunk,
      playPause,
      stop,
      scrub,
      setEngine,
      setVoice,
      setVoiceSpeed,
      voiceSpeed,
      audioSettingsOpen,
      openAudioSettings,
      closeAudioSettings,
      jumpTo,
      playlistItems,
      autoAdvanceBook,
      activeItemId: activeItem?.id ?? null,
      ghostItem,
      playSection,
      playText,
      jumpToItem,
      removePlaylistItem,
      clearPlaylist,
      reorderPlaylist,
      setAutoAdvanceBook,
      pendingReaderSyncBookId,
      markPendingReaderSync,
      clearPendingReaderSync,
    }),
    [
      session,
      openBook?.bookId,
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
      syncViewerToPlayback,
      rehighlightCurrentChunk,
      playPause,
      stop,
      scrub,
      setEngine,
      setVoice,
      setVoiceSpeed,
      voiceSpeed,
      audioSettingsOpen,
      openAudioSettings,
      closeAudioSettings,
      jumpTo,
      playlistItems,
      autoAdvanceBook,
      activeItem,
      ghostItem,
      playSection,
      playText,
      jumpToItem,
      removePlaylistItem,
      clearPlaylist,
      reorderPlaylist,
      setAutoAdvanceBook,
      pendingReaderSyncBookId,
      markPendingReaderSync,
      clearPendingReaderSync,
    ],
  );

  const cardBookMeta = useMemo(() => {
    if (session) {
      return {
        bookTitle: session.bookTitle,
        bookAuthor: session.bookAuthor,
        bookCoverPath: session.bookCoverPath,
        bookLanguage: session.bookLanguage,
      };
    }
    if (openBook) {
      return {
        bookTitle: openBook.bookTitle,
        bookAuthor: openBook.bookAuthor,
        bookCoverPath: openBook.bookCoverPath,
        bookLanguage: openBook.bookLanguage,
      };
    }
    if (activeItem) {
      return {
        bookTitle: activeItem.bookTitle ?? undefined,
        bookAuthor: activeItem.bookAuthor,
        bookCoverPath: activeItem.bookCoverPath ?? undefined,
        bookLanguage: activeItem.bookLanguage,
      };
    }
    return {
      bookTitle: undefined,
      bookAuthor: null,
      bookCoverPath: undefined,
      bookLanguage: "en",
    };
  }, [session, openBook, activeItem]);

  return (
    <AudioContext.Provider value={value}>
      {children}
      <audio ref={cloudAudioRef} className="hidden" />
      {showCard && (
        <div
          className={cn(
            "fixed bottom-12 left-12 z-[60] w-[calc(100%-6rem)] max-w-[640px] transition-opacity",
            exitingIdle || enteringIdle ? "duration-500" : "duration-300",
            (cardHidden || exitingIdle || enteringIdle) &&
              "opacity-0 pointer-events-none",
          )}
        >
          <TtsPlayer
            variant="floating"
            state={playbackState}
            bookFinished={bookFinished}
            loadPct={browserTts.state.loadPct}
            onPlayPause={handlePlayPause}
            onSkipNext={advanceToNextSection}
            canSkipAhead={canSkipAhead}
            ghostItem={ghostItem}
            onStop={stop}
            onScrub={scrub}
            bookTitle={cardBookMeta.bookTitle}
            bookAuthor={cardBookMeta.bookAuthor}
            bookCoverPath={cardBookMeta.bookCoverPath}
            bookId={session?.bookId ?? openBook?.bookId ?? activeItem?.bookId ?? undefined}
            canScrub={isCloud}
            queueItems={playlistItems}
            activeItemId={activeItem?.id ?? null}
            autoAdvanceBook={autoAdvanceBook}
            onReorder={reorderPlaylist}
            onRemove={removePlaylistItem}
            onClearAll={() => void clearPlaylist("all")}
            onClearUpcoming={() => void clearPlaylist("upcoming")}
            onToggleAutoAdvance={setAutoAdvanceBook}
            onJumpToItem={jumpToItem}
            onSyncToPlayback={syncViewerToPlayback}
            onMarkPendingReaderSync={markPendingReaderSync}
            hidden={cardHidden}
          />
        </div>
      )}
      <AudioSettingsModal
        open={audioSettingsOpen}
        onOpenChange={setAudioSettingsOpen}
        bookLanguage={cardBookMeta.bookLanguage}
        enginePref={enginePref}
        effectiveEngineId={isCloud ? enginePref : browserTts.effectiveEngineId}
        onEngineChange={setEngine}
        voicePref={voicePref}
        onVoiceChange={setVoice}
        voiceSpeed={voiceSpeed}
        onVoiceSpeedChange={setVoiceSpeed}
        userRole={
          session?.userRole ??
          openBook?.userRole ??
          ((user as { role?: import("@/types/book").UserRole })?.role) ??
          "regular"
        }
        quota={isCloud ? cloudTts.quota : null}
      />
    </AudioContext.Provider>
  );
}
