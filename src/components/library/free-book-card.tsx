"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FreeBook } from "@/types/free-book";
import { getPlaceholderCover } from "./book-cover";

interface FreeBookCardProps {
  book: FreeBook;
}

export function FreeBookCard({ book }: FreeBookCardProps) {
  return (
    <div className="group block">
      <div className="transition-transform duration-200 ease-out group-hover:-translate-y-[1%]">
        <div className="relative overflow-hidden rounded-md bg-paper-deep shadow-book transition-shadow duration-200 ease-out group-hover:shadow-book-lifted">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={book.title}
              loading="lazy"
              className="block aspect-[3/4] w-full object-cover"
            />
          ) : (
            <div
              className={cn(
                "flex aspect-[3/4] w-full items-center justify-center",
                getPlaceholderCover(book.title),
              )}
            >
              <Plus
                className="text-white/55"
                style={{ height: "26%", aspectRatio: "1 / 1" }}
                strokeWidth={1.5}
              />
            </div>
          )}

          {/* ponytail: expanding add button. Width animates; text is opacity-0
              until the pill is wide enough. Pointer-events isolated so the
              button does not steal the card hover. */}
          <button
            type="button"
            aria-label={`Add ${book.title}`}
            className="absolute bottom-2 right-2 flex h-7 w-7 items-center gap-1 overflow-hidden rounded-full bg-blue px-1.5 text-white shadow-md transition-all duration-200 ease-out hover:brightness-110 group-hover:w-[72px]"
            onClick={(e) => {
              e.stopPropagation();
              // ponytail: placeholder — wire to add-to-library flow later.
            }}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap text-sm font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              Add
            </span>
          </button>
        </div>
      </div>

      <div className="mt-2.5">
        <h4 className="line-clamp-2 text-sm font-medium text-espresso">
          {book.title}
        </h4>
        {book.author && (
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
            {book.author}
          </p>
        )}
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/70">
          {book.source}
        </p>
      </div>
    </div>
  );
}
