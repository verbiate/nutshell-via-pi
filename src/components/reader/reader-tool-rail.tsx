"use client";

import { BookOpen, Bookmark, PenLine, Lightbulb, Type } from "lucide-react";
import { READER_TOOLS, type ReaderTool } from "./reader-tools";
import { cn } from "@/lib/utils";

const ICONS = {
  "book-open": BookOpen,
  bookmark: Bookmark,
  "pen-line": PenLine,
  lightbulb: Lightbulb,
  type: Type,
} as const;

export interface ReaderToolRailProps {
  activeTool?: ReaderTool["id"] | null;
  onToolClick?: (id: ReaderTool["id"]) => void;
}

export function ReaderToolRail({
  activeTool,
  onToolClick,
}: ReaderToolRailProps) {
  return (
    <div
      className="absolute right-3 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-2 rounded-[30px] border border-line bg-card/80 p-2 backdrop-blur-sm sm:flex"
      role="toolbar"
      aria-label="Reader tools"
    >
      {READER_TOOLS.map((tool) => {
        const Icon = ICONS[tool.icon];
        const isActive = activeTool === tool.id;
        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => onToolClick?.(tool.id)}
            aria-label={tool.label}
            aria-current={isActive}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full border transition-colors",
              isActive
                ? "border-lav-ring bg-lav-soft text-lav shadow-[0_0_0_4px_rgba(126,112,234,0.12)]"
                : "border-line bg-card text-muted-foreground hover:border-lav-ring hover:text-lav",
            )}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
          </button>
        );
      })}
    </div>
  );
}
