"use client";

export interface ReadingProgressProps {
  percentage: number;
}

export function ReadingProgress({ percentage }: ReadingProgressProps) {
  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-50 h-1 bg-muted"
      role="progressbar"
      aria-valuenow={Math.round(percentage)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Reading progress: ${Math.round(percentage)}%`}
    >
      <div
        className="h-full bg-primary transition-all duration-300"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
