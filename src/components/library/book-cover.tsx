"use client";

import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

// ponytail: shared cover renderer for shelf + reader sidebar so the fly clone
// (captured from one) matches the other pixel-for-pixel. Placeholder = hashed
// gradient + centered icon, no overlaid title text — "like a real cover".
const PLACEHOLDER_COVERS = [
  "bg-[linear-gradient(150deg,#3b6ea5,#21456e)]",
  "bg-[linear-gradient(150deg,#1c1c22,#3a2740)]",
  "bg-[linear-gradient(150deg,#2a7d6f,#1c4a42)]",
  "bg-[linear-gradient(150deg,#6b4a8a,#3a2740)]",
  "bg-[linear-gradient(150deg,#b5563a,#6e2f1f)]",
];

export function getPlaceholderCover(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  return PLACEHOLDER_COVERS[Math.abs(hash) % PLACEHOLDER_COVERS.length];
}

export interface BookCoverProps {
  coverPath: string | null | undefined;
  title: string;
  /** Applied to the rendered root (img or placeholder). */
  className?: string;
  /**
   * cover=true → fill the container (h-full w-full object-cover), used by the
   * reader sidebar's fixed-size slot. Default (natural) → width-driven, the
   * image keeps its aspect (shelf card). Placeholder keeps its 3/4 aspect in
   * natural mode and fills in cover mode.
   */
  cover?: boolean;
}

export function BookCover({
  coverPath,
  title,
  className,
  cover = false,
}: BookCoverProps) {
  if (coverPath) {
    return (
      <img
        src={`/api/files/${coverPath}`}
        alt={title}
        className={cn(
          "block w-full",
          cover ? "h-full object-cover" : "h-auto",
          className,
        )}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex w-full items-center justify-center",
        cover && "h-full",
        getPlaceholderCover(title),
        className,
      )}
      style={{ aspectRatio: cover ? undefined : "3 / 4" }}
    >
      {/* ponytail: container-relative icon so the placeholder reads as a cover at any size. */}
      <BookOpen
        className="text-white/55"
        style={{ height: "26%", aspectRatio: "1 / 1" }}
        strokeWidth={1.5}
      />
    </div>
  );
}
