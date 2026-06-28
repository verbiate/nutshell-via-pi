import type { FreeBook } from "@/types/free-book";
import { BookshopBanner } from "./bookshop-banner";
import { FreeBookCard } from "./free-book-card";
import { SmoothScrollArea } from "./smooth-scroll-area";

interface FindBooksViewProps {
  books: FreeBook[];
}

export function FindBooksView({ books }: FindBooksViewProps) {
  return (
    <SmoothScrollArea className="lg:absolute lg:inset-0">
      <div className="px-6 pb-6">
        <BookshopBanner />

        <div className="mt-8">
          <h2 className="font-serif text-lg font-medium uppercase tracking-wide text-espresso">
            Free books
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Classic books in the public domain. Courtesy of Project Gutenberg
            and Standard Ebooks.
          </p>
        </div>

        {books.length > 0 ? (
          <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] items-end gap-x-5 gap-y-6">
            {books.map((book) => (
              <FreeBookCard key={book.id} book={book} />
            ))}
          </div>
        ) : (
          <div className="mt-10 rounded-xl border border-dashed border-line bg-paper-deep/50 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No free books found. Drop{" "}
              <code className="rounded bg-white px-1 py-0.5 text-xs">.epub</code>{" "}
              files into{" "}
              <code className="rounded bg-white px-1 py-0.5 text-xs">
                public/free-books/
              </code>{" "}
              to populate this section.
            </p>
          </div>
        )}
      </div>
    </SmoothScrollArea>
  );
}
