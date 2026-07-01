"use client";

import { cn } from "@/lib/utils";

export interface ReadingProgressProps {
  percentage: number;
  hidden?: boolean;
}

export function ReadingProgress({ percentage, hidden = false }: ReadingProgressProps) {
  const clamped = Math.max(0, Math.min(100, percentage));
  const label = `${Math.round(clamped)}% complete`;

  return (
    <div
      className={cn(
        "absolute bottom-12 right-12 z-50 text-sm text-muted-foreground tabular-nums transition-opacity duration-300",
        hidden && "opacity-0 pointer-events-none",
      )}
      role="progressbar"
      aria-hidden={hidden}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Reading progress: ${label}`}
    >
      {label}
    </div>
  );
}
