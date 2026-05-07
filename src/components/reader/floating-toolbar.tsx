"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Highlighter, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FloatingToolbarProps {
  visible: boolean;
  position: { top: number; left: number };
  placement: "above" | "below";
  onHighlight: () => void;
  onExplain: () => void;
  onDismiss: () => void;
}

export function FloatingToolbar({
  visible,
  position,
  placement,
  onHighlight,
  onExplain,
  onDismiss,
}: FloatingToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);

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

  return createPortal(
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Text selection actions"
      className={cn(
        "fixed z-[70] flex items-center gap-1 h-9 px-2 py-1",
        "rounded-md border border-border bg-popover shadow-lg",
        "animate-in fade-in zoom-in-95 duration-150"
      )}
      style={{
        top: position.top,
        left: Math.max(8, position.left),
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onHighlight}
        className="gap-1.5 h-7 px-2"
        aria-label="Highlight selected text"
      >
        <Highlighter className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-medium">Highlight</span>
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        variant="ghost"
        size="sm"
        onClick={onExplain}
        className="gap-1.5 h-7 px-2"
        aria-label="Explain selected passage"
      >
        <Sparkles className="h-3.5 w-3.5 text-violet-600" />
        <span className="text-xs font-medium">Explain this to me</span>
      </Button>
    </div>,
    document.body
  );
}
