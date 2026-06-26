import { segmentText, isValidHref } from "@/lib/explainer/citations";

/**
 * Renders explainer text with inline citation links. Valid #ch: citations
 * (basename present in spineHrefs) become buttons that call onNavigateToHref;
 * invalid ones degrade to plain label text (never a dead jump). Non-#ch:
 * markdown and plain text render verbatim.
 *
 * ponytail: a <span role="button"> (not <a>) because navigation is in-app
 * via the reader's navigateTo(href), not a URL change. data-href carries the
 * target for tests + future debugging.
 */
export function ExplainerContent({
  content,
  spineHrefs,
  onNavigateToHref,
}: {
  content: string;
  spineHrefs: string[];
  onNavigateToHref?: (href: string) => void;
}) {
  const segments = segmentText(content);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.value}</span>;
        if (!isValidHref(seg.href, spineHrefs) || !onNavigateToHref) {
          return <span key={i}>{seg.label}</span>;
        }
        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            data-href={seg.href}
            className="cursor-pointer underline decoration-primary/60 underline-offset-2 hover:decoration-primary"
            onClick={() => onNavigateToHref(seg.href)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNavigateToHref(seg.href);
              }
            }}
          >
            {seg.label}
          </span>
        );
      })}
    </>
  );
}
