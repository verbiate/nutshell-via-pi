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
    <Link href={`/book/${id}/reader`} className="group block">
      <div className="overflow-hidden rounded-md transition-shadow duration-200 hover:shadow-card">
        <div className="relative aspect-[3/4] w-full bg-paper-deep">
          {coverPath ? (
            <img
              src={`/api/files/${coverPath}`}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[linear-gradient(160deg,#3FD9B0,#1f8f70)] p-3 text-center">
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
