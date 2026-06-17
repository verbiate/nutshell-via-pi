import Link from "next/link";
import { BookOpen } from "lucide-react";

interface BookCardProps {
  id: string;
  title: string;
  author: string | null;
  language: string;
  coverPath: string | null;
  progress?: number | null;
}

const PLACEHOLDER_COLORS = [
  "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155", "#1e293b",
];

function getPlaceholderColor(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  return PLACEHOLDER_COLORS[Math.abs(hash) % PLACEHOLDER_COLORS.length];
}

export function BookCard({ id, title, author, language, coverPath, progress }: BookCardProps) {
  const bgColor = getPlaceholderColor(title);

  return (
    <Link href={`/book/${id}`} className="group block">
      <div className="overflow-hidden rounded-md transition-shadow duration-200 hover:shadow-md">
        <div className="relative aspect-[3/4] w-full bg-slate-100">
          {coverPath ? (
            <img
              src={`/api/files/${coverPath}`}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/10 to-black/10"
              style={{ backgroundColor: bgColor }}
            >
              <BookOpen className="h-12 w-12 text-white/40" />
            </div>
          )}
          {language && language !== "und" && (
            <span className="absolute right-1.5 top-1.5 rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium text-slate-700 shadow-sm">
              {language.toUpperCase()}
            </span>
          )}
          {progress !== undefined && progress !== null && progress > 0 && (
            <>
              <div
                className="absolute bottom-0 left-0 right-0 h-1 bg-black/10"
                role="progressbar"
                aria-valuenow={Math.round(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Reading progress: ${Math.round(progress)}%`}
              >
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="absolute bottom-1.5 right-1.5 text-[10px] font-medium text-white drop-shadow-sm">
                {Math.round(progress)}%
              </span>
            </>
          )}
        </div>
        <div className="px-1 pt-2">
          <h3 className="line-clamp-2 text-base font-semibold leading-tight text-slate-900">
            {title}
          </h3>
          {author && (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {author}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
