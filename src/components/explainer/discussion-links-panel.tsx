import { useMemo } from "react";
import { aggregateLinks } from "@/lib/explainer/citations";
import { BookOpen } from "lucide-react";

/**
 * Aggregated "Links in this discussion" — every citation across the supplied
 * message texts, deduped by basename and ordered by spine reading order so the
 * panel doubles as a map of how far the discussion reaches. Renders nothing
 * when there are no valid citations.
 */
export function DiscussionLinksPanel({
  texts,
  spineItems,
  onNavigateToHref,
}: {
  texts: string[];
  spineItems: { href: string; index: number }[];
  onNavigateToHref?: (href: string) => void;
}) {
  const links = useMemo(
    () => aggregateLinks(texts, spineItems),
    [texts, spineItems]
  );
  if (links.length === 0) return null;
  return (
    <div className="border-b border-border px-4 py-2">
      <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <BookOpen className="h-3 w-3" />
        Links in this discussion
      </p>
      <ul className="space-y-0.5">
        {links.map((l) => (
          <li key={l.href}>
            <button
              type="button"
              disabled={!onNavigateToHref}
              onClick={() => onNavigateToHref?.(l.href)}
              className="block w-full truncate text-left text-xs text-primary/90 hover:text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              title={l.label}
            >
              {l.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
