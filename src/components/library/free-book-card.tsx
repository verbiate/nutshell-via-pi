"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { FreeBook } from "@/types/free-book";
import { getPlaceholderCover } from "./book-cover";

interface FreeBookCardProps {
  book: FreeBook;
}

export function FreeBookCard({ book }: FreeBookCardProps) {
  const router = useRouter();
  const [added, setAdded] = useState(book.added ?? false);
  const [isAdding, setIsAdding] = useState(false);

  async function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    if (added || isAdding) return;
    setIsAdding(true);
    try {
      const res = await fetch("/api/free-books/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: `${book.id}.epub` }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to add book");
      }
      setAdded(true);
      toast.success(`Added “${book.title}” to your bookshelf`);
      // Refresh server data so the Bookshelf tab sees the new book.
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Could not add book");
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <div className="group block">
      <div className="transition-transform duration-200 ease-out group-hover:-translate-y-[1%]">
        <div className="relative overflow-hidden rounded-md bg-paper-deep shadow-book transition-shadow duration-200 ease-out group-hover:shadow-book-lifted">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={book.title}
              loading="lazy"
              className="block h-auto w-full"
            />
          ) : (
            <div
              className={cn(
                "flex w-full items-center justify-center",
                getPlaceholderCover(book.title),
              )}
              style={{ aspectRatio: "3 / 4" }}
            >
              <Plus
                className="text-white/55"
                style={{ height: "26%", aspectRatio: "1 / 1" }}
                strokeWidth={1.5}
              />
            </div>
          )}

          {added ? (
            <button
              type="button"
              disabled
              title="Added to your bookshelf"
              aria-label={`${book.title} — added to your bookshelf`}
              className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full border border-tan-dark bg-white text-muted-foreground shadow-md"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} />
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Add ${book.title}`}
              disabled={isAdding}
              onClick={handleAdd}
              className="absolute bottom-2 right-2 flex h-7 w-7 items-center gap-1 overflow-hidden rounded-full border border-tan-dark bg-white px-1.5 text-blue shadow-md transition-all duration-200 ease-out group-hover:w-[72px] group-hover:border-transparent group-hover:bg-blue group-hover:text-white disabled:opacity-70"
            >
              {isAdding ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 shrink-0" />
              )}
              <span className="whitespace-nowrap text-sm font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                Add
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
