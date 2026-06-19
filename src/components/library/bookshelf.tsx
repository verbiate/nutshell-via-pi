import { BookCard } from "./book-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LibraryBook } from "@/types/book";

interface BookshelfProps {
  books: LibraryBook[];
}

export function Bookshelf({ books }: BookshelfProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-x-5 gap-y-6 px-5">
      {books.map((book) => (
        <BookCard
          key={book.id}
          id={book.id}
          title={book.title}
          author={book.author}
          coverPath={book.coverPath}
          progress={book.progress}
          hasProgress={book.hasProgress}
        />
      ))}
    </div>
  );
}

export function BookshelfSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-x-5 gap-y-6 px-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[3/4] w-full rounded-md" />
          <div className="mt-2 h-1.5 w-full" />
        </div>
      ))}
    </div>
  );
}
