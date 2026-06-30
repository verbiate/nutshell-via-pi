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

/**
 * Convert GitHub-flavored Markdown into plain text suitable for TTS.
 *
 * Strips the syntax a speech engine would read aloud literally: emphasis
 * markers (** * _ __ ~~), heading hashes, list bullets, blockquote markers,
 * code fences/backticks, link URLs (keeping label text), images (keeping alt),
 * and table pipes. Reuses ensureTerminalPunctuation so blocks pause naturally.
 *
 * ponytail: hand-rolled regex pass, not a full AST walk. Handles the common
 * LLM-reply markdown; ceiling = pathological nesting, raw HTML inside
 * markdown, or `*` used as a literal multiplication sign in prose will survive
 * as-is. If those show up audibly, swap to remark-parse + mdast-to-text.
 */
export function markdownToTtsText(md: string): string {
  return md
    // Fenced code blocks → keep inner text (drop lang fence + backticks)
    .replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, "$1")
    // Images ![alt](url) → alt text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Links [text](url) → text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // ATX headings: leading #’s
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    // Horizontal rules (---, ***, ___) before other dash handling
    .replace(/^\s{0,3}([-*_])\1{2,}\s*$/gm, "")
    // Blockquote markers
    .replace(/^\s{0,3}>+\s?/gm, "")
    // Bold **text** / __text__
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    // Italic *text* / _text_
    .replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, "$2")
    // Strikethrough ~~text~~
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    // Inline code `code` → code
    .replace(/`([^`]+)`/g, "$1")
    // Unordered list markers (- * +) — preserve indentation
    .replace(/^(\s*)[-*+]\s+/gm, "$1")
    // Ordered list markers (1. )
    .replace(/^(\s*)\d+\.\s+/gm, "$1")
    // Markdown table separator rows (| : - |) and pipes
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, "")
    .replace(/\|/g, " ")
    // Collapse intra-line whitespace, cap blank runs
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => ensureTerminalPunctuation(line.trim()))
    .filter(Boolean)
    .join("\n");
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

function markdownDemo(): void {
  const md = `## Heading\nThis is **bold** and *italic* and \`code\`.\n- item one\n- item two\n> a quote\n[link text](http://x) and ![alt](y).\n1. first\n2. second`;
  const out = markdownToTtsText(md);
  const checks: Array<[string, RegExp]> = [
    ["no heading hash", /^Heading\./],
    ["bold stripped", /\bbold\b/],
    ["italic stripped", /\bitalic\b/],
    ["code backticks stripped", /\bcode\b/],
    ["no list bullet", /item one/],
    ["no blockquote marker", /a quote/],
    ["link label kept, url dropped", /link text/],
    ["image alt kept, url dropped", /alt/],
    ["no ordered marker", /first/],
    ["no asterisk survives", !/\*/.test(out) ? /^/ : /NEVER/],
    ["no backtick survives", !/`/.test(out) ? /^/ : /NEVER/],
  ];
  for (const [label, re] of checks) {
    if (!re.test(out)) {
      throw new Error(`markdownToTtsText failed: ${label}\noutput: ${JSON.stringify(out)}`);
    }
  }
}

if (process.env.TTS_PREPARE_TEXT_DEMO) {
  demo();
  markdownDemo();
}
