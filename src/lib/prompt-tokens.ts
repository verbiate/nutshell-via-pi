// ponytail: pure-data module (no Prisma, no server imports) so the admin UI
// client component and the server-side prompt-builder share one source of
// truth for which tokens exist and which templates accept them. Add a token
// here, then handle it in fillTemplate's vars dict in prompt-builder.ts.

export type PromptTemplateType =
  | "book"
  | "section"
  | "passage"
  | "book_pass2"
  | "book_metadata"
  | "shelf_extract_narrative"
  | "shelf_extract_nonfiction"
  | "shelf_extract_generic"
  | "shelf_nav"
  | "shelf_answer";

export interface PromptToken {
  token: string;
  description: string;
  appliesTo: PromptTemplateType[];
}

export const AVAILABLE_TOKENS: readonly PromptToken[] = [
  {
    token: "title",
    description: "Book title (from the EPUB metadata).",
    appliesTo: ["book", "section", "passage", "book_pass2"],
  },
  {
    token: "author",
    description: "Book author. Falls back to \"Unknown\" if missing.",
    appliesTo: ["book", "section", "passage", "book_pass2"],
  },
  {
    token: "language",
    description: "The book's source language (from EPUB metadata).",
    appliesTo: ["book", "book_pass2"],
  },
  {
    token: "target_language",
    description: "Output language the reader requested.",
    appliesTo: ["book", "section", "passage", "book_pass2"],
  },
  {
    token: "book_text",
    description: "Full plaintext of the book (extracted at upload).",
    appliesTo: ["book", "section", "passage", "book_pass2", "book_metadata"],
  },
    {
      token: "expanded_metadata",
      description:
        "LLM-extracted Expanded Book Metadata block (all 6 fields: title, subtitle, author, author gender, narrative type, language, description). Empty when metadata hasn't been extracted yet.",
      appliesTo: ["book", "section", "passage", "book_pass2"],
    },
    {
      token: "chapter_index",
      description:
        "Ready-to-use markdown citation links for every ToC entry ([Label](#ch:href)). The model copies these verbatim to emit deep links to chapters. Required for explainer citations to render as clickable chapter links.",
      appliesTo: ["book", "section", "passage"],
    },
  {
    token: "text",
    description: "Alias of {{book_text}}. Kept for backwards compatibility.",
    appliesTo: ["book"],
  },
  {
    token: "chosen_text",
    description:
      "The selected snippet: passage text or extracted section text.",
    appliesTo: ["section", "passage"],
  },
  {
    token: "chapter_maps",
    description:
      "Per-cited-book chapter maps with prefixed deep-link hrefs ([Label](#ch:<bookId>:<basename>)) the model copies verbatim into the visible reply to cite specific chapters. Empty block per book when no ToC. Only shelf_answer injects this.",
    appliesTo: ["shelf_answer"],
  },
  {
    token: "conversation",
    description:
      "Recent prior turns of the same shelf discussion (last ~6, User:/Assistant: lines) so a follow-up like 'deep links for that?' routes to and is answered in the context of the prior turn. Empty string on the first turn (no history).",
    appliesTo: ["shelf_nav", "shelf_answer"],
  },
  {
    token: "section_title",
    description: "Title of the section being explained (from the TOC).",
    appliesTo: ["section"],
  },
  {
    token: "previous_response",
    description:
      "Output of the hidden first pass. Only meaningful when two-pass refinement is enabled.",
    appliesTo: ["book_pass2"],
  },
] as const;

export function tokensFor(type: PromptTemplateType): readonly PromptToken[] {
  return AVAILABLE_TOKENS.filter((t) => t.appliesTo.includes(type));
}
