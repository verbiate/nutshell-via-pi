"use client";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TtsPlaybackState } from "@/hooks/use-tts-playback";

export interface TtsPlayerProps {
  state: TtsPlaybackState;
  onPlayPause: () => void;
  onScrub: (time: number) => void;
  onClose: () => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TtsPlayer({ state, onPlayPause, onScrub, onClose }: TtsPlayerProps) {
  const visible = state.state !== "IDLE";
  const isLoading = state.state === "LOADING";
  const isGenerating = state.state === "GENERATING";
  const isPlaying = state.state === "PLAYING";

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-60 h-16 flex items-center gap-3 px-4 border-t border-border bg-background/95 backdrop-blur-sm transition-transform duration-300",
        visible ? "translate-y-0" : "translate-y-full"
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
      <span className="text-sm font-medium truncate max-w-[200px] sm:max-w-[300px] text-foreground shrink-0">
        {isLoading ? "Loading voice model…" : isGenerating ? "Generating audio..." : state.sectionTitle}
      </span>

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
