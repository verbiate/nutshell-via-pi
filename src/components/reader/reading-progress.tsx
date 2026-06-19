"use client";

import { cn } from "@/lib/utils";

export interface ReadingProgressProps {
  percentage: number;
  sidebarOpen?: boolean;
}

export function ReadingProgress({ percentage, sidebarOpen = false }: ReadingProgressProps) {
  const clamped = Math.max(0, Math.min(100, percentage));
  const label = `${Math.round(clamped)}%`;

  return (
    <div
      className={cn(
        "absolute bottom-0 z-50 flex h-10 max-w-[600px] -translate-x-1/2 items-center transition-[left] duration-[var(--reader-dur)] ease-reader",
        sidebarOpen
          ? "left-[calc(50%-(var(--reader-sidebar-w)+var(--reader-rail-w))/2)]"
          : "left-1/2",
      )}
      style={{ width: "50vw" }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Reading progress: ${label}`}
    >
      <div className="relative h-1 w-full rounded-full bg-muted">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-grad transition-all duration-300"
          style={{ width: `${clamped}%` }}
        />
        <div
          className="transition-[left] duration-300 absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-card px-2.5 py-0.5 text-xs font-bold text-espresso shadow-[0_4px_10px_-4px_rgba(34,24,5,0.4)] tabular-nums"
          style={{ left: `${clamped}%` }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
