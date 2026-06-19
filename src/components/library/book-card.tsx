import Link from "next/link";
import { BookOpen } from "lucide-react";

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

  return (
    <Link
      href={`/book/${id}/reader`}
      className="group block rounded-md"
    >
      {/* ponytail: lift the cover only, not the progress slot. Transform and filter animate on separate elements — combining them on one element made the hover snap instead of ease. */}
      <div className="transition-transform duration-200 ease-out group-hover:-translate-y-[1%]">
        {/* ponytail: box-shadow, not filter:drop-shadow — drop-shadow rendered against the child's rectangular bbox and was clipped by this element's own overflow:hidden, leaving shadow only in the rounded corners. box-shadow follows border-radius and paints outside the box. */}
        <div className="overflow-hidden rounded-md bg-paper-deep shadow-book transition-shadow duration-200 ease-out group-hover:shadow-book-lifted">
          {coverPath ? (
            <img
              src={`/api/files/${coverPath}`}
              alt={title}
              className="block h-auto w-full scale-[1.02]"
            />
          ) : (
            <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 bg-[linear-gradient(160deg,#3FD9B0,#1f8f70)] p-3 text-center">
              <BookOpen className="h-7 w-7 text-white/45" />
              <span className="line-clamp-4 font-serif text-sm font-medium leading-tight text-white">
                {title}
              </span>
              {author && (
                <span className="line-clamp-1 text-[11px] text-white/70">
                  {author}
                </span>
              )}
            </div>
          )}
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
    </Link>
  );
}
