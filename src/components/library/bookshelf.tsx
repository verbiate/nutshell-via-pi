import { BookCard } from "./book-card";
import { Skeleton } from "@/components/ui/skeleton";

interface Book {
  id: string;
  title: string;
  author: string | null;
  language: string;
  coverPath: string | null;
  progress?: number | null;
}

interface BookshelfProps {
  books: Book[];
}

export function Bookshelf({ books }: BookshelfProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6 gap-y-8">
      {books.map((book) => (
        <BookCard
          key={book.id}
          id={book.id}
          title={book.title}
          author={book.author}
          language={book.language}
          coverPath={book.coverPath}
          progress={book.progress}
        />
      ))}
    </div>
  );
}

export function BookshelfSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6 gap-y-8">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[3/4] w-full rounded-md" />
          <div className="space-y-2 px-1 pt-2">
            <Skeleton className="h-5 w-[70%]" />
            <Skeleton className="h-4 w-[40%]" />
          </div>
        </div>
      ))}
    </div>
  );
}
