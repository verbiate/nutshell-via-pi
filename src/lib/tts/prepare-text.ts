const BLOCK_CLOSE_RE =
  /<\/(?:p|div|h[1-6]|li|blockquote|tr|td|th|section|article|aside|header|footer|main|nav|figure|figcaption|pre|address|hr)>/gi;
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;

/**
 * Convert raw HTML into plain text suitable for TTS.
 *
 * - Block-level elements become newline-separated lines.
 * - Intra-line whitespace is collapsed.
 * - Lines missing sentence-ending punctuation get a trailing period.
 *
 * Mirrors the regex strip pattern in section-extractor.ts, but preserves
 * structure so TTS pauses between chapter numbers, titles, bylines, etc.
 */
export function htmlToTtsText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(BLOCK_CLOSE_RE, "\n")
    .replace(BR_RE, "\n")
    .replace(TAG_RE, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCodePoint(Number(code));
      } catch {
        return "";
      }
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => ensureTerminalPunctuation(line.trim()))
    .filter(Boolean)
    .join("\n");
}

function ensureTerminalPunctuation(line: string): string {
  if (!line) return "";
  // Sentence terminators and ellipsis already provide a pause.
  if (/[.!?…]$/.test(line)) return line;
  // Strip trailing clause punctuation, then end with a period.
  return line.replace(/[:;,—–\-]+$/, "") + ".";
}

function demo(): void {
  const html = `<h1>6</h1><h1>Commit: The Nuna Story</h1><p>Jini Kim</p><p>Cofounder and CEO</p><p>Nuna is the story of...</p>`;
  const expected = "6.\nCommit: The Nuna Story.\nJini Kim.\nCofounder and CEO.\nNuna is the story of...";
  const actual = htmlToTtsText(html);
  if (actual !== expected) {
    throw new Error(
      `htmlToTtsText demo mismatch:\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`,
    );
  }
}

if (process.env.TTS_PREPARE_TEXT_DEMO) {
  demo();
}
