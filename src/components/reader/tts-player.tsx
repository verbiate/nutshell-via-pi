"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
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
import { Label } from "@/components/ui/label";
import { Loader2, Minimize2, Maximize2, Settings, X, ListMusic, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { ENGINES } from "@/lib/tts/engines";
import { engineSupportsLanguage, type EngineId } from "@/lib/tts/languages";
import type { TtsVoice } from "@/lib/tts/types";
import type { UserRole } from "@/types/book";
import type { TtsPlaybackState } from "@/hooks/use-tts-playback";
import type { CloudQuota } from "@/hooks/use-tts-cloud";
import { BookCover } from "@/components/library/book-cover";
import { useSceneTransition } from "@/components/transitions/scene-transition";
import { TtsQueue } from "./tts-queue";
import type { PlaylistItem } from "@/types/playlist";

// ponytail: the three user-facing engine choices. cloud/browser aren't pickable
// here — cloud maps to "Premium", browser has no slot in the UI.
const ENGINE_OPTIONS: ReadonlyArray<{ id: EngineId; label: string }> = [
  { id: "kokoro", label: "Free (Highest Quality)" },
  { id: "supertonic", label: "Free (Faster)" },
  { id: "cloud", label: "Premium" },
];

export interface TtsPlayerProps {
  state: TtsPlaybackState;
  /** Model-load progress 0–100, surfaced while `state.state === "LOADING"`. */
  loadPct?: number;
  onPlayPause: () => void;
  /** Stop resets playback to IDLE (nothing loaded) but keeps the card mounted. */
  onStop: () => void;
  onScrub: (time: number) => void;
  bookLanguage: string;
  enginePref: EngineId;
  /**
   * Engine actually driving playback after any runtime fallback (e.g. WebGPU →
   * browser). When provided, the voice catalog is pulled from this engine so
   * the picker refreshes after a fallback. Defaults to enginePref.
   */
  effectiveEngineId?: EngineId;
  onEngineChange: (id: EngineId) => void;
  voicePref: string;
  onVoiceChange: (id: string) => void;
  userRole: UserRole;
  /** Cloud-only quota snapshot; rendered as a small badge next to the engines. */
  quota?: CloudQuota | null;
  /** Optional book metadata shown below the section title. */
  bookTitle?: string;
  bookAuthor?: string | null;
  bookCoverPath?: string | null;
  bookId?: string;
  /**
   * Jump the registered viewer to the section currently being read by TTS
   * (section nav + chunk re-highlight). No-op unless the viewer is registered
   * and openBook matches the session. Used for the same-book-on-reader click.
   */
  onSyncToPlayback?: () => Promise<unknown> | void;
  /**
   * Mark that the next mount of this book's reader should sync to the TTS
   * position even when playback is paused. Set just before off-reader nav.
   */
  onMarkPendingReaderSync?: (bookId: string) => void;
  /**
   * Whether the scrubber can seek. Only the cloud `<audio>` path supports
   * scrubbing; the chunked AudioBuffer path is read-only progress. Defaults
   * false.
   */
  canScrub?: boolean;
  /**
   * Fade the card out on reader pointer-idle. Caller carves out active
   * playback (PLAYING/LOADING/GENERATING) so the card stays put mid-audio.
   */
  hidden?: boolean;
  /**
   * `reader` = absolute inside the reader wrapper (legacy). `floating` =
   * relative, meant to live inside a fixed-position provider wrapper.
   */
  variant?: "reader" | "floating";
  /** User playlist items. */
  queueItems?: PlaylistItem[];
  /** Id of the currently active playlist item. */
  activeItemId?: string | null;
  /** Whether the player should auto-advance to the next book segment. */
  autoAdvanceBook?: boolean;
  /** Jump to a playlist item. */
  onJumpToItem?: (itemId: string) => void;
  /** Remove a playlist item. */
  onRemove?: (itemId: string) => void;
  /** Clear all items and stop. */
  onClearAll?: () => void;
  /** Clear upcoming items. */
  onClearUpcoming?: () => void;
  /** Toggle auto-advance. */
  onToggleAutoAdvance?: (value: boolean) => void;
  /** Reorder upcoming playlist items. */
  onReorder?: (orderedIds: string[]) => void;
  // ponytail: end-of-book signal from AudioProvider. Renders "Book finished" +
  // an inert heart in place of the play button. Decorative — clicks are ignored
  // at the provider level (handlePlayPause early-returns when bookFinishedRef
  // is true) and the button is disabled here so the affordance is unambiguous.
  bookFinished?: boolean;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function voiceLabel(v: TtsVoice): string {
  // ponytail: Kokoro English voices carry region (US/GB) → "Bella (US)".
  // Supertonic + non-en Kokoro have none → plain label. One rule covers both.
  return v.region ? `${v.label} (${v.region})` : v.label;
}

/**
 * Branch the floating player's book-thumbnail click into one of three nav
 * strategies. Extracted pure so it is unit-testable without a DOM/router.
 *
 * - `same-book-on-reader`: already on `/book/{id}/reader` → sync viewer + open
 *   details in place (no route change).
 * - `other-reader`: on a different `/book/...` reader route → plain router.push
 *   (the reader stays mounted and swaps books).
 * - `scene-nav`: shelf/profile/elsewhere → full scene transition.
 */
export type ThumbnailNavTarget =
  | "same-book-on-reader"
  | "other-reader"
  | "scene-nav";

export function resolveThumbnailNav(
  pathname: string | null,
  bookId: string,
): ThumbnailNavTarget {
  if (pathname === `/book/${bookId}/reader`) return "same-book-on-reader";
  if (pathname?.startsWith("/book/")) return "other-reader";
  return "scene-nav";
}

// ponytail: solid play/pause as inline SVG (heroicons paths) — avoids pulling a
// second icon lib for two glyphs. Decorative: button has its own aria-label.
function PlaySolid({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653Z" />
    </svg>
  );
}

function PauseSolid({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M6.75 5.25a.75.75 0 0 1 .75.75v12a.75.75 0 0 1-.75.75H5.25a.75.75 0 0 1-.75-.75V6a.75.75 0 0 1 .75-.75h1.5Zm9 0a.75.75 0 0 1 .75.75v12a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75V6a.75.75 0 0 1 .75-.75h1.5Z" />
    </svg>
  );
}

export function TtsPlayer({
  state,
  loadPct = 0,
  onPlayPause,
  onStop,
  onScrub,
  bookLanguage,
  enginePref,
  effectiveEngineId,
  onEngineChange,
  voicePref,
  onVoiceChange,
  userRole,
  quota = null,
  bookTitle,
  bookAuthor,
  bookCoverPath,
  bookId,
  onSyncToPlayback,
  onMarkPendingReaderSync,
  canScrub = false,
  hidden = false,
  variant = "reader",
  queueItems = [],
  activeItemId = null,
  autoAdvanceBook = true,
  onJumpToItem,
  onRemove,
  onClearAll,
  onClearUpcoming,
  onToggleAutoAdvance,
  onReorder,
  bookFinished = false,
}: TtsPlayerProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { navigate } = useSceneTransition();

  // ponytail: pure decision so the thumbnail branching is unit-testable without
  // a DOM/router. goToBook below maps each branch to its side effects.
  async function goToBook() {
    if (!bookId) return;
    const nav = resolveThumbnailNav(pathname, bookId);
    console.log("[TtsPlayer.goToBook]", { nav, pathname, bookId });
    switch (nav) {
      case "same-book-on-reader":
        // Jump the viewer to the current TTS page. Sidebar state is owned by
        // the reader; leave it untouched (open stays open, closed stays closed).
        await onSyncToPlayback?.();
        return;
      case "other-reader":
        // Book-to-book: plain nav. ReaderClient stays mounted and runs its
        // close -> placeholder -> reopen swap. Bypassing scene navigate is
        // required -- the reader keeps a BookshelfSnapshot (data-scene="library")
        // in the DOM that scene navigate would detect and animate as a full
        // shelf -> reader slide-in. Mark pending so the reader syncs to the TTS
        // position on mount even when playback is paused.
        onMarkPendingReaderSync?.(bookId);
        router.push(`/book/${bookId}/reader`);
        return;
      case "scene-nav":
        // Shelf / profile / elsewhere: full scene transition (no cover fly).
        // Mark pending so the reader syncs to the TTS position on mount even
        // when playback is paused.
        onMarkPendingReaderSync?.(bookId);
        navigate(`/book/${bookId}/reader`, "forward", { bookId });
        return;
    }
  }

  const isLoading = state.state === "LOADING";
  const isGenerating = state.state === "GENERATING";
  const isPlaying = state.state === "PLAYING";
  // ponytail: nothing loaded (IDLE) — e.g. on first show or after Stop. The main
  // button then acts as "Read aloud from here" instead of resume.
  const isIdle = state.state === "IDLE";
  // ponytail: section complete with a next section available → card advertises
  // "Play next section" and clicking advances (explicit — bypasses auto-advance).
  const isEnded = state.state === "ENDED";
  // ponytail: end-of-book — pure affordance. Heart replaces the play button,
  // the card reads "Book finished", and the row hides the book-meta sub-title.
  const isBookFinished = !!bookFinished && state.state === "IDLE";

  // ponytail: voice catalog follows the *effective* engine so a WebGPU→browser
  // fallback refreshes the picker to browser voices. The engine radio + cloud
  // flag still track enginePref — browser isn't a selectable radio option and
  // cloud never falls back through this hook.
  const activeEngine = ENGINES[effectiveEngineId ?? enginePref];
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
    <div
      className={cn(
        "rounded-xl border border-border bg-background/95 p-3 shadow-card backdrop-blur-sm transition-all duration-300",
        variant === "reader"
          ? "absolute bottom-12 left-12"
          : "relative w-full",
        // ponytail: when collapsed the card shrinks to fit the 3 mini buttons,
        // instead of holding its wide max-width box with empty space.
        collapsed
          ? "w-fit"
          : "w-[calc(100%-6rem)] max-w-[640px]",
        hidden && "opacity-0 pointer-events-none",
      )}
      role="region"
      aria-label="Audio player"
      aria-hidden={hidden}
    >
      {/* Scrubber or model-load progress */}
      {!collapsed && (
      <div className="mb-3 flex items-center gap-3">
        {isLoading ? (
          <>
            <div
              className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(loadPct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Voice model load progress"
            >
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.min(100, Math.max(0, loadPct))}%` }}
              />
            </div>
            <span className="hidden text-[11px] text-muted-foreground tabular-nums sm:inline">
              Loading voice model… {Math.round(loadPct)}%
            </span>
          </>
        ) : (
          <>
            <Slider
              value={[state.currentTime]}
              max={state.duration || 100}
              step={1}
              onValueChange={([v]) => onScrub(v)}
              // ponytail: free engines can't seek — read-only progress bar.
              // Also disabled while generating, and inert when duration is unknown
              // (speechSynthesis fallback exposes no position).
              disabled={isGenerating || !canScrub || state.duration === 0}
              className="flex-1"
            />
            {state.duration > 0 && (
              <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                {formatTime(state.currentTime)} / {formatTime(state.duration)}
              </span>
            )}
          </>
        )}
      </div>
      )}

      {/* Controls row */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand audio player" : "Minimize audio player"}
          className="shrink-0 active:scale-[0.96] transition-transform"
        >
          {collapsed ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
        </Button>

        <Button
          size="icon"
          onClick={onPlayPause}
          disabled={isBookFinished}
          aria-label={isBookFinished ? "Finished" : isIdle ? "Read aloud" : isEnded ? "Play next section" : isPlaying ? "Pause" : isLoading ? "Loading" : isGenerating ? "Cancel" : "Resume"}
          className="h-10 w-10 shrink-0 rounded-full bg-chocolate text-white hover:bg-chocolate/90 active:scale-[0.96] transition-transform"
        >
          {isBookFinished ? (
            <Heart className="h-4 w-4 text-blue" fill="currentColor" />
          ) : isLoading || isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin text-blue" />
          ) : isPlaying ? (
            <PauseSolid className="h-4 w-4 text-blue" />
          ) : (
            <PlaySolid className="h-4 w-4 text-blue" />
          )}
        </Button>

        {!collapsed && bookId && (
          <button
            type="button"
            onClick={goToBook}
            aria-label={`Open ${bookTitle ?? "book"}`}
            className="shrink-0 rounded-md outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <div className="w-[30px] overflow-hidden rounded-md bg-paper-deep shadow-book">
              <BookCover coverPath={bookCoverPath} title={bookTitle ?? "book"} />
            </div>
          </button>
        )}

        {!collapsed && (
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="truncate text-sm font-medium text-foreground">
            {isBookFinished
              ? "Book finished"
              : isIdle
                ? "Start reading from here"
                : isEnded
                  ? "Play next section"
                  : isGenerating
                    ? "Generating audio..."
                    : state.sectionTitle}
          </span>
          {!isIdle && !isEnded && !isBookFinished && (bookTitle || bookAuthor) && (
            <span className="truncate text-xs text-muted-foreground">
              {bookTitle}
              {bookTitle && bookAuthor ? " · " : ""}
              {bookAuthor}
            </span>
          )}
        </div>
        )}

        {!collapsed && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setSettingsOpen(true)}
          aria-label="Audio settings"
          className="shrink-0 active:scale-[0.96] transition-transform"
        >
          <Settings className="h-4 w-4" />
        </Button>
        )}

        {!collapsed && onJumpToItem && queueItems.length > 0 && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setPlaylistOpen(true)}
          aria-label="Playlist"
          className="shrink-0 active:scale-[0.96] transition-transform"
        >
          <ListMusic className="h-4 w-4" />
        </Button>
        )}

        {!isIdle && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onStop}
          aria-label="Stop"
          className="shrink-0 active:scale-[0.96] transition-transform"
        >
          <X className="h-4 w-4" />
        </Button>
        )}
      </div>

      {/* Settings modal */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Audio settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
          </div>
        </DialogContent>
      </Dialog>
      {/* Playlist dialog */}
      {onJumpToItem && (
      <TtsQueue
        open={playlistOpen}
        onOpenChange={setPlaylistOpen}
        items={queueItems}
        activeItemId={activeItemId}
        autoAdvanceBook={autoAdvanceBook}
        onJumpToItem={onJumpToItem}
        onRemove={onRemove ?? (() => {})}
        onClearAll={onClearAll ?? (() => {})}
        onClearUpcoming={onClearUpcoming ?? (() => {})}
        onToggleAutoAdvance={onToggleAutoAdvance ?? (() => {})}
        onReorder={onReorder ?? (() => {})}
      />
      )}
    </div>
  );
}
