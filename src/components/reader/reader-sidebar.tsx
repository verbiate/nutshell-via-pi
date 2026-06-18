"use client";

import {
  BookOpen,
  Bookmark,
  PenLine,
  Lightbulb,
  Type,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  READER_TOOLS,
  type ReaderTool,
  sectionNumberFor,
} from "./reader-tools";

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
}

export function ReaderSidebar({ activeTool, onToolClick }: ReaderSidebarProps) {
  const label = activeTool ? `Section ${sectionNumberFor(activeTool)}` : null;

  return (
    <div className="absolute bottom-0 right-0 top-12 z-40 hidden border-l border-line bg-card/80 backdrop-blur-sm sm:flex">
      {/* Content panel — visible only when a tool is active */}
      {activeTool && (
        <aside
          role="complementary"
          aria-label={label ?? undefined}
          className="flex w-[260px] flex-col border-r border-line"
        >
          <header className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold text-foreground">{label}</h2>
          </header>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-4 px-5 py-4">
              {[0, 1, 2].map((i) => (
                <p
                  key={i}
                  className="text-sm leading-relaxed text-muted-foreground"
                >
                  {label}
                </p>
              ))}
            </div>
          </ScrollArea>
        </aside>
      )}

      {/* Tool rail — always visible, docked to the right edge */}
      <nav
        role="toolbar"
        aria-label="Reader tools"
        className="flex w-[60px] flex-col items-center justify-center gap-2 px-2 py-3"
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
      </nav>
    </div>
  );
}
