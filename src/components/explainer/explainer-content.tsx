import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isValidHref } from "@/lib/explainer/citations";

/**
 * Renders explainer/discussion text as GitHub-flavored Markdown. The #ch:
 * citation scheme stays in-app navigation: a custom `a` renderer turns valid
 * `[label](#ch:basename)` citations into the same keyboard-accessible
 * role="button" span ExplainerContent always emitted (data-href carries the
 * target for tests + debugging), invalid ones degrade to plain label text
 * (never a dead jump), and real http(s) links open in a new tab.
 *
 * ponytail: react-markdown is safe by default — raw HTML is escaped (no
 * rehype-raw), so LLM-injected markup can't XSS. It re-parses on every prop
 * change, which is exactly what streaming needs.
 */
const components = (spineHrefs: string[], onNavigateToHref?: (href: string) => void): Components => ({
  a({ href, children }) {
    if (href?.startsWith("#ch:")) {
      const target = href.slice(4);
      if (isValidHref(target, spineHrefs) && onNavigateToHref) {
        return (
          <span
            role="button"
            tabIndex={0}
            data-href={target}
            className="cursor-pointer underline decoration-primary/60 underline-offset-2 hover:decoration-primary"
            onClick={() => onNavigateToHref(target)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNavigateToHref(target);
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
}: {
  content: string;
  spineHrefs: string[];
  onNavigateToHref?: (href: string) => void;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components(spineHrefs, onNavigateToHref)}>
      {content}
    </ReactMarkdown>
  );
});
