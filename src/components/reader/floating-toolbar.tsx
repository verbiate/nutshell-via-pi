"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Lightbulb, Copy, Highlighter, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { HIGHLIGHT_COLORS, highlightSwatchStyle } from "./highlight-colors";
import { useAudio } from "@/components/audio/audio-context";
import type { TtsStartPos } from "@/components/audio/audio-context";
import type { PlaylistBookMeta } from "@/types/playlist";

export interface FloatingToolbarProps {
  visible: boolean;
  position: { top: number; left: number } | null;
  selectedText: string;
  bookId: string;
  sectionHref: string;
  sectionLabel: string;
  bookMeta?: PlaylistBookMeta;
  startPos?: TtsStartPos;
  onHighlight: (color: string) => void;
  onAsk: () => void;
  onDismiss: () => void;
}

export function FloatingToolbar({
  visible,
  position,
  selectedText,
  bookId,
  sectionHref,
  sectionLabel,
  bookMeta,
  startPos,
  onHighlight,
  onAsk,
  onDismiss,
}: FloatingToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { playlistItems, playSection } = useAudio();
  const hasPlaylist = playlistItems.length > 0;

  const startFromSelection = (mode: "now" | "next" | "last") => {
    void playSection(
      bookId,
      sectionHref,
      sectionLabel,
      mode,
      startPos,
      bookMeta,
    );
    onDismiss();
  };

  // Hide on Escape — do NOT trigger highlight or explain
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, onDismiss]);

  if (!visible) return null;

  const positioned = position !== null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedText);
    } catch (err) {
      console.warn("[FloatingToolbar] copy failed:", err);
    }
    onDismiss();
  };

  return createPortal(
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Text selection actions"
      data-floating-toolbar
      className={cn(
        "fixed z-[70] flex w-[220px] flex-col rounded-xl border border-border bg-popover p-1.5",
        "shadow-[0_8px_30px_-6px_rgba(34,24,5,0.25)]",
        positioned && "animate-in fade-in duration-100"
      )}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: positioned ? "visible" : "hidden",
      }}
    >
      <button
        type="button"
        onClick={onAsk}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        aria-label="Ask about this passage"
      >
        <Lightbulb className="h-4 w-4 text-lav" />
        Ask about this
      </button>

      {hasPlaylist ? (
        <>
          <button
            type="button"
            onClick={() => startFromSelection("now")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            aria-label="Play now"
          >
            <Play className="h-4 w-4 fill-current" />
            Play now
          </button>
          <button
            type="button"
            onClick={() => startFromSelection("next")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            aria-label="Play next"
          >
            <Play className="h-4 w-4 fill-current" />
            Play next
          </button>
          <button
            type="button"
            onClick={() => startFromSelection("last")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            aria-label="Play last"
          >
            <Play className="h-4 w-4 fill-current" />
            Play last
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => startFromSelection("now")}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          aria-label="Start reading from here"
        >
          <Play className="h-4 w-4 fill-current" />
          Start reading from here
        </button>
      )}

      <button
        type="button"
        onClick={handleCopy}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        aria-label="Copy selected text"
      >
        <Copy className="h-4 w-4" />
        Copy
      </button>

      <div className="my-1 h-px bg-border" />

      <div className="flex items-center gap-2 px-3 pb-1.5 pt-0.5">
        <Highlighter className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Create a note:
        </span>
      </div>

      <div className="mb-1 ml-auto mr-auto flex items-center justify-center gap-4 rounded-full border border-border/60 bg-background/40 px-4 py-2">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onHighlight(c.hex)}
            className="h-6 w-6 rounded-full ring-1 ring-black/5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lav"
            style={highlightSwatchStyle(c.hex)}
            aria-label={`Highlight in ${c.label}`}
          />
        ))}
      </div>
    </div>,
    document.body
  );
}
