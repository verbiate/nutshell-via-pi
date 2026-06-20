"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  Bookmark,
  PenLine,
  Lightbulb,
  Type,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { READER_TOOLS, type ReaderTool } from "./reader-tools";

const ICONS = {
  "book-open": BookOpen,
  bookmark: Bookmark,
  "pen-line": PenLine,
  lightbulb: Lightbulb,
  type: Type,
} as const;

export interface ReaderSidebarProps {
  activeTool: ReaderTool["id"] | null;
  onToolClick: (id: ReaderTool["id"]) => void;
  panels: Record<ReaderTool["id"], ReactNode>;
}

export function ReaderSidebar({
  activeTool,
  onToolClick,
  panels,
}: ReaderSidebarProps) {
  const isOpen = activeTool !== null;

  // ponytail: hold the last active tool so content stays mounted during the
  // close slide — otherwise the panel goes empty mid-animation.
  const [lastTool, setLastTool] = useState<ReaderTool["id"] | null>(activeTool);
  useEffect(() => {
    if (activeTool) setLastTool(activeTool);
  }, [activeTool]);

  const displayedTool = activeTool ?? lastTool;
  const label = displayedTool
    ? READER_TOOLS.find((t) => t.id === displayedTool)?.label ?? null
    : null;

  return (
    <>
      {/*
        Layer 2 — sliding content panel.
        Sits UNDER the book (z-30) so the book's right-edge shadow falls on it
        as the book narrows. Slides in from the right by the rail width so its
        right edge lands exactly at the viewport edge when closed (no overshoot).
        Opacity hides the panel's visible-but-translated state — see .wip-
        reference/sidebar-example-a.html, which uses the same trick.
        Lockstep with the book's width transition (same duration + ease) keeps
        their meeting edge gapless throughout the animation.
      */}
      <aside
        aria-label={label ?? undefined}
        aria-hidden={!isOpen}
        className="absolute bottom-0 right-[var(--reader-rail-w)] top-0 z-20 hidden w-[var(--reader-sidebar-w)] flex-col bg-background sm:flex [box-shadow:8px_0_16px_-10px_rgba(34,24,5,0.3)]"
        style={{
          transform: `translateX(${isOpen ? "0px" : "var(--reader-rail-w)"})`,
          opacity: isOpen ? 1 : 0,
          transitionProperty: "transform, opacity",
          transitionDuration: "var(--reader-dur)",
          transitionDelay: "var(--reader-delay, 0ms)",
          transitionTimingFunction: "cubic-bezier(.5, 0, .2, 1)",
        }}
      >
        {displayedTool && label && (
          <>
            <header className="border-b border-line px-5 py-3">
              <h2 className="text-sm font-semibold text-foreground">{label}</h2>
            </header>
            <ScrollArea className="min-h-0 flex-1">
              {panels[displayedTool]}
            </ScrollArea>
          </>
        )}
      </aside>

      {/*
        Rail — always visible on sm+, pinned to the right edge.
        Sits ABOVE both book and sidebar so the buttons stay reachable in every
        state. Solid bg-background so sliding layers don't bleed through.
      */}
      <nav
        role="toolbar"
        aria-label="Reader tools"
        className="absolute bottom-0 right-0 top-0 z-40 hidden w-[var(--reader-rail-w)] flex-col items-center justify-center gap-2 px-2 py-3 sm:flex"
      >
        {READER_TOOLS.map((tool) => {
          const Icon = ICONS[tool.icon];
          const isActive = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => onToolClick(tool.id)}
              aria-label={tool.label}
              aria-current={isActive}
              className={cn(
                "flex h-[46px] w-[46px] items-center justify-center rounded-full border transition-colors",
                isActive
                  ? "border-lav-ring bg-lav-soft text-lav shadow-[0_0_0_4px_rgba(161,127,240,0.18)]"
                  : "border-line bg-card text-muted-foreground hover:border-lav-ring hover:text-lav",
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
            </button>
          );
        })}
      </nav>
    </>
  );
}
