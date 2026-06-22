// ponytail: client-side token utilities shared by the admin Playground and
// the reader's Explainer panel. Mirrors the server's cl100k_base encoding
// (src/server/services/tokens.ts) — same approximation used everywhere.
// Server-side context-window lookup stays server-side (model-info.ts); the
// Playground fetches it via /api/admin/playground/model-info, the reader via
// the server component's prop chain.

import { countTokens as _countTokens } from "gpt-tokenizer/encoding/cl100k_base";

export function countTokens(text: string): number {
  if (!text) return 0;
  return _countTokens(text);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

// ponytail: per-type template scaffolding overhead. The DOMINANT term in an
// explainer follow-up is the full book plaintext (re-sent every turn — see
// rebuildSystemPrompt in explainer-threads.ts), which we count via
// book.txtTokens. These constants cover only the literal template prose
// AROUND the {{book_text}}/{{chosen_text}} substitutions: instructions,
// role framing, variable labels. ~400-600 tokens observed across the three
// default templates; rounded up to a safe single value.
export const EXPLAINER_TEMPLATE_TOKENS = 600;
