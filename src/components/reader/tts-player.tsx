"use client";

import { useState } from "react";
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
import { Play, Pause, Loader2, Minimize2, Maximize2, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ENGINES } from "@/lib/tts/engines";
import { engineSupportsLanguage, type EngineId } from "@/lib/tts/languages";
import type { TtsVoice } from "@/lib/tts/types";
import type { UserRole } from "@/types/book";
import type { TtsPlaybackState } from "@/hooks/use-tts-playback";
import type { CloudQuota } from "@/hooks/use-tts-cloud";

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
  /**
   * Whether the scrubber can seek. Only the cloud `<audio>` path supports
   * scrubbing; the chunked AudioBuffer path is read-only progress. Defaults
   * false.
   */
  canScrub?: boolean;
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
  canScrub = false,
}: TtsPlayerProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // ponytail: player is a permanent fixture in the bottom-left corner. The
  // minimize toggle collapses to a mini form (play + expand) instead of
  // unmounting — preserves state, avoids re-show affordances.
  const [collapsed, setCollapsed] = useState(false);
  const isLoading = state.state === "LOADING";
  const isGenerating = state.state === "GENERATING";
  const isPlaying = state.state === "PLAYING";
  // ponytail: nothing loaded (IDLE) — e.g. on first show or after Stop. The main
  // button then acts as "Read aloud from here" instead of resume.
  const isIdle = state.state === "IDLE";

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
      // ponytail: 48px corner padding matches the reader-chrome Bookshelf button
      // (header top-12 + px-12). EPUB wrapper's left edge is pinned to viewport-
      // left even when the sidebar opens, so this anchor stays aligned with
      // Bookshelf regardless of sidebar state.
      className="absolute bottom-12 left-12 z-50 w-[calc(100%-6rem)] max-w-[320px] rounded-xl border border-border bg-background/95 p-3 shadow-card backdrop-blur-sm transition-all duration-300"
      role="region"
      aria-label="Audio player"
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
          variant="outline"
          size="icon"
          onClick={onPlayPause}
          aria-label={isIdle ? "Read aloud" : isPlaying ? "Pause" : isLoading ? "Loading" : isGenerating ? "Cancel" : "Resume"}
          className="h-10 w-10 shrink-0 rounded-full active:scale-[0.96] transition-transform"
        >
          {isLoading || isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        {!collapsed && (
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="truncate text-sm font-medium text-foreground">
            {isIdle ? "Start reading from here" : isGenerating ? "Generating audio..." : state.sectionTitle}
          </span>
          {!isIdle && (bookTitle || bookAuthor) && (
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

        {!collapsed && !isIdle && (
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

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand audio player" : "Minimize audio player"}
          className="shrink-0 active:scale-[0.96] transition-transform"
        >
          {collapsed ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
        </Button>
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
    </div>
  );
}
