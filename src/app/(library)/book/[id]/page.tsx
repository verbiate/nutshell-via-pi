import { requireAuth } from "@/lib/auth-guards";
import { getBookForUser } from "@/server/services/library";
import { notFound } from "next/navigation";
import { BookOpen } from "lucide-react";
import { BookActions } from "./book-actions";

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuth();
  const book = await getBookForUser(id, user.id);

  if (!book) {
    notFound();
  }

  const toc = book.tocJson ? JSON.parse(book.tocJson) : [];

  return (
    <div className="py-8">
      <div className="flex flex-col gap-8 md:flex-row">
        {/* Cover */}
        <div className="flex-shrink-0">
          <div className="relative aspect-[3/4] w-full max-w-[280px] overflow-hidden rounded-md bg-slate-100">
            {book.coverPath ? (
              <img
                src={`/api/files/covers/${book.id}.jpg`}
                alt={book.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-slate-400">
                <BookOpen className="h-16 w-16 text-white/40" />
              </div>
            )}
          </div>
        </div>

        {/* Metadata */}
        <div className="flex-1">
          <h1 className="text-[28px] font-semibold text-slate-900">
            {book.title}
          </h1>
          {book.author && (
            <p className="mt-2 text-[20px] text-muted-foreground">
              {book.author}
            </p>
          )}
          <div className="mt-4 flex items-center gap-3">
            {book.language && book.language !== "und" && (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                {book.language.toUpperCase()}
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              Uploaded {book.createdAt.toLocaleDateString()}
            </span>
          </div>

          <BookActions
            bookId={book.id}
            initialLanguage={user.preferredLanguage || "en"}
          />

          {/* TOC Preview */}
          {toc.length > 0 && (
            <div className="mt-8">
              <h2 className="text-[20px] font-semibold text-slate-900">
                Table of Contents
              </h2>
              <ul className="mt-3 space-y-1">
                {toc.map((entry: any) => (
                  <li
                    key={entry.id}
                    className="text-sm text-muted-foreground"
                  >
                    {entry.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
