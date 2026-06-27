import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isValidHref, parseBookRef } from "@/lib/explainer/citations";

/**
 * Renders explainer/discussion text as GitHub-flavored Markdown. The #ch:
 * citation scheme stays in-app navigation: a custom `a` renderer turns valid
 * citations into the same keyboard-accessible role="button" span ExplainerContent
 * always emitted (data-href carries the target for tests + debugging), invalid
 * ones degrade to plain label text (never a dead jump), and real http(s) links
 * open in a new tab.
 *
 * Two citation forms:
 * - Origin book: `[Label](#ch:<basename>)` — validated against the open book's
 *   live spine (spineHrefs). Today's behavior, byte-for-byte.
 * - Attached (co-primary) book: `[Label](#ch:<bookId>:<basename>)` — validated
 *   against that book's hrefs (attachedBookHrefs[bookId], sourced from its
 *   DB tocJson). Click routes cross-book via onNavigateToBookSection.
 *
 * ponytail: react-markdown is safe by default — raw HTML is escaped (no
 * rehype-raw), so LLM-injected markup can't XSS. It re-parses on every prop
 * change, which is exactly what streaming needs.
 */
const components = (opts: {
  spineHrefs: string[];
  onNavigateToHref?: (href: string) => void;
  attachedBookHrefs?: Record<string, string[]>;
  onNavigateToBookSection?: (bookId: string, basename: string) => void;
}): Components => ({
  a({ href, children }) {
    if (href?.startsWith("#ch:")) {
      const target = href.slice(4);
      const { bookId, basename } = parseBookRef(target);

      // Cross-book citation → validate against the target book's hrefs
      if (bookId) {
        const bookHrefs = opts.attachedBookHrefs?.[bookId] ?? [];
        if (isValidHref(basename, bookHrefs) && opts.onNavigateToBookSection) {
          const onNav = opts.onNavigateToBookSection;
          return (
            <span
              role="button"
              tabIndex={0}
              data-book-id={bookId}
              data-book-href={basename}
              title="Opens in another book"
              className="cursor-pointer underline decoration-primary/60 underline-offset-2 hover:decoration-primary"
              onClick={() => onNav(bookId, basename)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onNav(bookId, basename);
                }
              }}
            >
              {children}
            </span>
          );
        }
        return <span>{children}</span>;
      }

      // Origin-book citation (today's path)
      if (isValidHref(target, opts.spineHrefs) && opts.onNavigateToHref) {
        return (
          <span
            role="button"
            tabIndex={0}
            data-href={target}
            className="cursor-pointer underline decoration-primary/60 underline-offset-2 hover:decoration-primary"
            onClick={() => opts.onNavigateToHref!(target)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                opts.onNavigateToHref!(target);
              }
            }}
          >
            {children}
          </span>
        );
      }
      return <span>{children}</span>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
});

export const ExplainerContent = memo(function ExplainerContent({
  content,
  spineHrefs,
  onNavigateToHref,
  attachedBookHrefs,
  onNavigateToBookSection,
}: {
  content: string;
  spineHrefs: string[];
  onNavigateToHref?: (href: string) => void;
  attachedBookHrefs?: Record<string, string[]>;
  onNavigateToBookSection?: (bookId: string, basename: string) => void;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components({ spineHrefs, onNavigateToHref, attachedBookHrefs, onNavigateToBookSection })}
    >
      {content}
    </ReactMarkdown>
  );
});
