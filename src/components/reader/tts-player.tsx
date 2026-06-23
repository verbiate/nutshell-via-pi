"use client";

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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Play, Pause, Loader2, X } from "lucide-react";
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
  onScrub: (time: number) => void;
  onClose: () => void;
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
  /** Keep the bar visible even when state is IDLE (e.g. after engine switch). */
  forceVisible?: boolean;
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
  onScrub,
  onClose,
  bookLanguage,
  enginePref,
  effectiveEngineId,
  onEngineChange,
  voicePref,
  onVoiceChange,
  userRole,
  quota = null,
  forceVisible = false,
}: TtsPlayerProps) {
  const visible = forceVisible || state.state !== "IDLE";
  const isLoading = state.state === "LOADING";
  const isGenerating = state.state === "GENERATING";
  const isPlaying = state.state === "PLAYING";

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
        "fixed bottom-0 left-0 right-0 z-60 h-16 flex items-center gap-3 px-4 border-t border-border bg-background/95 backdrop-blur-sm transition-transform duration-300",
        visible ? "translate-y-0" : "translate-y-full",
      )}
      role="region"
      aria-label="Audio player"
    >
      {/* Play / Pause / Spinner */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onPlayPause}
        aria-label={isPlaying ? "Pause" : isLoading ? "Loading" : isGenerating ? "Cancel" : "Play"}
        className="shrink-0"
      >
        {isLoading || isGenerating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </Button>

      {/* Section label */}
      <span className="text-sm font-medium truncate max-w-[160px] sm:max-w-[240px] text-foreground shrink-0">
        {isGenerating ? "Generating audio..." : state.sectionTitle}
      </span>

      {/* Engine radio group — hidden below lg where the bar gets crowded.
          ponytail: each option is wrapped so disabled engines still surface a
          tooltip via the non-disabled label span receiving pointer events. */}
      <TooltipProvider>
        <RadioGroup
          value={enginePref}
          onValueChange={(v) => onEngineChange(v as EngineId)}
          className="hidden lg:flex flex-row items-center gap-3 shrink-0"
          aria-label="Text-to-speech engine"
        >
          {ENGINE_OPTIONS.map((opt) => {
            const reason = disabledReason(opt.id);
            const disabled = reason !== null;
            const radio = (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <RadioGroupItem
                  value={opt.id}
                  id={`tts-eng-${opt.id}`}
                  disabled={disabled}
                  className="size-3.5"
                />
                <Label
                  htmlFor={`tts-eng-${opt.id}`}
                  className={cn(
                    "text-xs font-medium cursor-pointer",
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

      {/* ponytail: Premium-only quota badge. Hidden unless the cloud engine is
          active and a quota snapshot has been fetched. */}
      {quotaBadge && (
        <span
          className="hidden lg:inline text-[11px] tabular-nums text-muted-foreground shrink-0 px-1.5 py-0.5 rounded border border-border bg-muted/40"
          title="Monthly Premium TTS generation quota"
        >
          {quotaBadge}
        </span>
      )}

      {/* Voice picker */}
      <Select value={isCloud ? "default" : voicePref} onValueChange={onVoiceChange}>
        <SelectTrigger
          size="sm"
          className="hidden sm:flex w-[150px] shrink-0"
          aria-label="Voice"
        >
          <SelectValue placeholder="Voice" />
        </SelectTrigger>
        <SelectContent>
          {/* ponytail: cloud voices are picked server-side per tier; show one
              placeholder option so the dropdown isn't empty. */}
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

      {/* Model-load progress — replaces scrubber affordance while loading. */}
      {isLoading && (
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="h-1 w-24 bg-muted rounded-full overflow-hidden"
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
          <span className="text-xs text-muted-foreground hidden md:inline">
            Loading voice model… {Math.round(loadPct)}%
          </span>
        </div>
      )}

      {/* Progress scrubber */}
      <div className="flex-1 min-w-0">
        <Slider
          value={[state.currentTime]}
          max={state.duration || 100}
          step={1}
          onValueChange={([v]) => onScrub(v)}
          disabled={isGenerating}
          className="w-full"
        />
      </div>

      {/* Duration */}
      <span className="text-xs text-muted-foreground tabular-nums shrink-0 hidden sm:inline">
        {formatTime(state.currentTime)} / {formatTime(state.duration)}
      </span>

      {/* Close */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        aria-label="Close audio player"
        className="shrink-0"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
