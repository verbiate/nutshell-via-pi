"use client";

import type { CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ponytail: shared section header for reader-sidebar panels. Two variants
// driven by onToggle — collapsible <button> w/ chevron (bookmarks, highlights
// groups) or static <div> (discussions). Badge always hugs the label inline
// per Figma 698:355; never pushed to the right edge.
export function SectionHeader({
  label,
  count,
  swatchStyle,
  isCollapsed,
  onToggle,
}: {
  label: string;
  count: number;
  swatchStyle?: CSSProperties;
  isCollapsed?: boolean;
  onToggle?: () => void;
}) {
  const collapsible = typeof onToggle === "function";
  const Tag = collapsible ? "button" : "div";
  return (
    <Tag
      type={collapsible ? "button" : undefined}
      onClick={onToggle}
      aria-expanded={collapsible ? !isCollapsed : undefined}
      className={cn(
        "flex h-[30px] w-full items-center gap-2 border-b border-line/50 px-12 text-left",
        collapsible && "w-full"
      )}
    >
      {collapsible && (
        <ChevronDown
          className={cn(
            "h-[14px] w-[14px] shrink-0 text-foreground transition-transform",
            isCollapsed && "-rotate-90"
          )}
        />
      )}
      <span className="flex min-w-0 items-center gap-1.5 truncate type-section-label text-foreground">
        {swatchStyle && (
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={swatchStyle}
            aria-hidden
          />
        )}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] font-medium tabular-nums text-foreground">
        {count}
      </span>
    </Tag>
  );
}
