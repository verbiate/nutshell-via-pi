"use client";

import { useRef } from "react";
import { useSceneTransition } from "@/components/transitions/scene-transition";
import { BookCover } from "./book-cover";

interface BookCardProps {
  id: string;
  title: string;
  author: string | null;
  coverPath: string | null;
  progress?: number | null;
  hasProgress?: boolean;
}

export function BookCard({ id, title, author, coverPath, progress, hasProgress }: BookCardProps) {
  const showProgress = !!hasProgress && progress != null;
  const { navigate } = useSceneTransition();
  // ponytail: ref the rounded+shadowed cover frame so the fly clone looks like a
  // traveling book (rounding + shadow live on this wrapper, not the inner img).
  const coverRef = useRef<HTMLDivElement>(null);

  const go = () => {
    const node = coverRef.current;
    const hero =
      node && node.getBoundingClientRect
        ? { node: node.cloneNode(true) as HTMLElement, rect: node.getBoundingClientRect() }
        : undefined;
    navigate(`/book/${id}/reader`, "forward", hero ? { hero } : undefined);
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
      aria-label={`Open ${title}`}
      className="group block cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {/* ponytail: lift the cover only, not the progress slot. Transform and filter animate on separate elements — combining them on one element made the hover snap instead of ease. */}
      <div className="transition-transform duration-200 ease-out group-hover:-translate-y-[1%]">
        {/* ponytail: box-shadow, not filter:drop-shadow — drop-shadow rendered against the child's rectangular bbox and was clipped by this element's own overflow:hidden, leaving shadow only in the rounded corners. box-shadow follows border-radius and paints outside the box. */}
        <div
          ref={coverRef}
          data-book-cover=""
          className="overflow-hidden rounded-md bg-paper-deep shadow-book transition-shadow duration-200 ease-out group-hover:shadow-book-lifted"
        >
          <BookCover coverPath={coverPath} title={title} className="scale-[1.02]" />
        </div>
      </div>
      {/* ponytail: fixed-height progress slot keeps a common cover baseline whether or not there is progress */}
      <div className="mt-2 h-1.5 w-full">
        {showProgress && (
          <div
            className="h-full w-full overflow-hidden rounded-full bg-black/10"
            role="progressbar"
            aria-valuenow={Math.round(progress!)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Reading progress: ${Math.round(progress!)}%`}
          >
            <div
              className="h-full rounded-full bg-grad transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
