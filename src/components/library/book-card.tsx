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

// ponytail: cover-style gradients (muted, book-appropriate) picked deterministically
const PLACEHOLDER_COVERS = [
  "bg-[linear-gradient(150deg,#3b6ea5,#21456e)]",
  "bg-[linear-gradient(150deg,#1c1c22,#3a2740)]",
  "bg-[linear-gradient(150deg,#2a7d6f,#1c4a42)]",
  "bg-[linear-gradient(150deg,#6b4a8a,#3a2740)]",
  "bg-[linear-gradient(150deg,#b5563a,#6e2f1f)]",
];

function getPlaceholderCover(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  return PLACEHOLDER_COVERS[Math.abs(hash) % PLACEHOLDER_COVERS.length];
}

export function BookCard({ id, title, author, language, coverPath, progress }: BookCardProps) {
  const coverClass = getPlaceholderCover(title);

  return (
    <Link href={`/book/${id}`} className="group block">
      <div className="overflow-hidden rounded-md transition-shadow duration-200 hover:shadow-card">
        <div className="relative aspect-[3/4] w-full bg-paper-deep">
          {coverPath ? (
            <img
              src={`/api/files/${coverPath}`}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center ${coverClass}`}
            >
              <BookOpen className="h-12 w-12 text-white/40" />
            </div>
          )}
          {language && language !== "und" && (
            <span className="absolute right-1.5 top-1.5 rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium text-espresso shadow-sm">
              {language.toUpperCase()}
            </span>
          )}
          {progress !== undefined && progress !== null && progress > 0 && (
            <div
              className="absolute bottom-0 left-0 right-0 h-1 bg-black/10"
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Reading progress: ${Math.round(progress)}%`}
            >
              <div
                className="h-full bg-grad transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        <div className="px-1 pt-2">
          <h3 className="line-clamp-2 font-serif text-base font-medium leading-tight text-foreground">
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
