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
  // ponytail: usePrevious pattern — keep last active tool mounted during close slide
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeTool) setLastTool(activeTool);
  }, [activeTool]);

  const displayedTool = activeTool ?? lastTool;
  const tool = displayedTool
    ? READER_TOOLS.find((t) => t.id === displayedTool) ?? null
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
        aria-label={tool?.label ?? undefined}
        aria-hidden={!isOpen}
        className="absolute bottom-0 right-[var(--reader-rail-w)] top-0 z-20 hidden w-[var(--reader-sidebar-w)] flex-col gap-9 bg-background sm:flex [box-shadow:8px_0_16px_-10px_rgba(34,24,5,0.3)]"
        style={{
          transform: `translateX(${isOpen ? "0px" : "var(--reader-rail-w)"})`,
          opacity: isOpen ? 1 : 0,
          transitionProperty: "transform, opacity",
          transitionDuration: "var(--reader-dur)",
          transitionDelay: "var(--reader-delay, 0ms)",
          transitionTimingFunction: "cubic-bezier(.5, 0, .2, 1)",
        }}
      >
        {tool && (
          <>
            {/*
              ponytail: Contents (reader) renders its own book-title headline
              inside the panel, so it skips the generic tab header. Every other
              tab uses the shared title + description + icon header.
            */}
            {tool.id !== "reader" && (
              <header className="flex items-center gap-4 px-12 pt-12">
                <div className="min-w-0 flex-1">
                  <h2
                    className="font-serif text-[20px] font-medium leading-[1.2] text-foreground"
                    style={{
                      letterSpacing: "-0.005em",
                      hangingPunctuation: "first last",
                    }}
                  >
                    {tool.label}
                  </h2>
                  <p
                    className="mt-1 text-xs font-semibold leading-[1.35] text-foreground/60"
                    style={{ hangingPunctuation: "first last" }}
                  >
                    {tool.description}
                  </p>
                </div>
                {(() => {
                  const Icon = ICONS[tool.icon];
                  return (
                    <Icon
                      className="h-16 w-16 shrink-0 text-foreground/30"
                      strokeWidth={1.2}
                      aria-hidden
                    />
                  );
                })()}
              </header>
            )}
            {tool.id === "bulb" ? (
              // ponytail: bulb (explainer threads) is chat-shaped — its
              // ThreadView anchors a header at top and composer at bottom with
              // the messages scrolling between. Skipping the outer ScrollArea
              // lets the panel's internal `h-full + flex-1 overflow-y-auto`
              // layout work; otherwise heights don't propagate and the whole
              // panel scrolls as one block (header + composer go along for
              // the ride). Other panels stay list-shaped and keep ScrollArea.
              <div className="min-h-0 flex-1 flex flex-col">
                {panels[tool.id]}
              </div>
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                {/* ponytail: pb-12 gives every panel a uniform 48px trailing
                    margin so the last item never butts against the sidebar's
                    bottom edge (matches the px-12 horizontal margin). */}
                <div className="pb-12">{panels[tool.id]}</div>
              </ScrollArea>
            )}
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
