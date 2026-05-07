import Link from "next/link";
import { BookOpen } from "lucide-react";

interface BookCardProps {
  id: string;
  title: string;
  author: string | null;
  language: string;
  coverPath: string | null;
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

export function BookCard({ id, title, author, language, coverPath }: BookCardProps) {
  const bgColor = getPlaceholderColor(title);

  return (
    <Link href={`/book/${id}`} className="group block">
      <div className="overflow-hidden rounded-md">
        <div className="relative aspect-[3/4] w-full bg-slate-100">
          {coverPath ? (
            <img
              src={`/api/files/covers/${id}.jpg`}
              alt={title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
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
        </div>
        <div className="pt-2">
          <h3 className="line-clamp-2 text-[20px] font-semibold leading-tight text-slate-900">
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
