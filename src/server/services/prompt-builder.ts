import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { extractSectionText } from "./section-extractor";

export function fillTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// ponytail: shared result shape so callers (explainer.ts, explainer-threads.ts)
// can hash, size-guard, and rebuild prompts without type drift between cases.
// metadataVersion: updatedAt of the BookMetadata row (or undefined when no row).
// Threaded into computeContentHash so re-extracting metadata invalidates
// cached explainers — the prompt's {{expanded_metadata}} block may now differ.
export interface BuiltPrompt {
  prompt: string;
  sourceText: string;     // the chosen snippet (book/section/passage)
  bookText: string;       // the full book plaintext (== sourceText for book type)
  bookMd5: string;        // unique book identifier for cache keying
  promptVersion: number;
  metadataVersion?: string;
}

async function loadBookText(txtPath: string): Promise<string> {
  const txtBuffer = await storage.read(txtPath);
  return txtBuffer.toString("utf-8");
}

// ponytail: formats the LLM-extracted BookMetadata row as a labeled block for
// {{expanded_metadata}} substitution. Returns empty string when no row exists
// (stray books, or extraction failed) so prompts that reference the token
// don't break — fillTemplate's ?? "" fallback would also catch undefined, but
// being explicit avoids emitting the literal "{{expanded_metadata}}" string.
type BookMetadataRow = {
  title: string;
  subtitle: string | null;
  author: string | null;
  authorGender: string | null;
  isNarrative: boolean | null;
  language: string | null;
  description: string | null;
};

export function formatExpandedMetadata(m: BookMetadataRow | null): string {
  if (!m) return "";
  const lines = [
    "Expanded metadata:",
    `Title: ${m.title}`,
    `Subtitle: ${m.subtitle ?? "none"}`,
    `Author: ${m.author ?? "Unknown"}`,
    `Author gender: ${m.authorGender ?? "undeclared"}`,
    `Narrative: ${
      m.isNarrative === null
        ? "unknown"
        : m.isNarrative
          ? "narrative"
          : "non-narrative"
    }`,
    `Language: ${m.language ?? "unknown"}`,
    `Description: ${m.description ?? "none"}`,
  ];
  return lines.join("\n");
}

export async function buildBookPrompt(
  bookId: string,
  language: string
): Promise<BuiltPrompt> {
  const book = await db.epubFile.findUnique({
    where: { id: bookId },
    include: { bookMetadata: true },
  });
  if (!book) throw new Error("Book not found");

  const template = await db.promptTemplate.findUnique({ where: { type: "book" } });
  if (!template) throw new Error("Book prompt template not found");

  const sourceText = await loadBookText(book.txtPath);

  const prompt = fillTemplate(template.content, {
    title: book.title,
    author: book.author ?? "Unknown",
    language: book.language,
    target_language: language,
    // ponytail: book template uses only {{book_text}} (== source). Aliasing
    // {{text}} → source too, in case an admin references it for backwards compat.
    book_text: sourceText,
    text: sourceText,
    expanded_metadata: formatExpandedMetadata(book.bookMetadata),
  });

  return {
    prompt,
    sourceText,
    bookText: sourceText,
    bookMd5: book.md5,
    promptVersion: template.version,
    metadataVersion: book.bookMetadata?.updatedAt.toISOString(),
  };
}

export async function buildSectionPrompt(
  bookId: string,
  sectionHref: string,
  language: string
): Promise<BuiltPrompt & { sectionTitle: string }> {
  const book = await db.epubFile.findUnique({
    where: { id: bookId },
    include: { bookMetadata: true },
  });
  if (!book) throw new Error("Book not found");

  const template = await db.promptTemplate.findUnique({ where: { type: "section" } });
  if (!template) throw new Error("Section prompt template not found");

  // Read both: the section's text (the focus) and the full book (context).
  // ponytail: two disk reads in parallel — section text from the EPUB spine,
  // full text from the pre-extracted txt file. ~50ms + ~50ms typical.
  const [sectionText, bookText] = await Promise.all([
    extractSectionText(book.epubPath, sectionHref),
    loadBookText(book.txtPath),
  ]);

  let sectionTitle = "Unknown Section";
  if (book.tocJson) {
    const toc = JSON.parse(book.tocJson) as Array<{ label: string; href: string; subitems?: unknown[] }>;
    const findTitle = (items: typeof toc): string | null => {
      for (const item of items) {
        if (item.href === sectionHref) return item.label;
        if (item.subitems && Array.isArray(item.subitems)) {
          const found = findTitle(item.subitems as typeof toc);
          if (found) return found;
        }
      }
      return null;
    };
    const found = findTitle(toc);
    if (found) sectionTitle = found;
  }

  const prompt = fillTemplate(template.content, {
    title: book.title,
    author: book.author ?? "Unknown",
    section_title: sectionTitle,
    target_language: language,
    chosen_text: sectionText,
    book_text: bookText,
    expanded_metadata: formatExpandedMetadata(book.bookMetadata),
  });

  return {
    prompt,
    sourceText: sectionText,
    bookText,
    bookMd5: book.md5,
    promptVersion: template.version,
    metadataVersion: book.bookMetadata?.updatedAt.toISOString(),
    sectionTitle,
  };
}

export async function buildPassagePrompt(
  bookId: string,
  passageText: string,
  language: string
): Promise<BuiltPrompt> {
  const book = await db.epubFile.findUnique({
    where: { id: bookId },
    include: { bookMetadata: true },
  });
  if (!book) throw new Error("Book not found");

  const template = await db.promptTemplate.findUnique({ where: { type: "passage" } });
  if (!template) throw new Error("Passage prompt template not found");

  // Full book for context, passage text for focus
  const bookText = await loadBookText(book.txtPath);

  const prompt = fillTemplate(template.content, {
    title: book.title,
    author: book.author ?? "Unknown",
    target_language: language,
    chosen_text: passageText,
    book_text: bookText,
    expanded_metadata: formatExpandedMetadata(book.bookMetadata),
  });

  return {
    prompt,
    sourceText: passageText,
    bookText,
    bookMd5: book.md5,
    promptVersion: template.version,
    metadataVersion: book.bookMetadata?.updatedAt.toISOString(),
  };
}

// ponytail: two-phase pass-2 builder. The orchestrator needs the template's
// version UP FRONT (for the contentHash salt, before pass 1 runs) but can only
// fill {{previous_response}} AFTER pass 1 returns. Splitting the load from
// the fill avoids a second template lookup and keeps each function single-
// responsibility. Caller passes bookText through from BuiltPrompt — re-reading
// from disk would double the IO cost on every two-pass request.

export async function loadBookPass2Template(): Promise<{
  content: string;
  version: number;
}> {
  const template = await db.promptTemplate.findUnique({
    where: { type: "book_pass2" },
  });
  if (!template) throw new Error("book_pass2 prompt template not found");
  return { content: template.content, version: template.version };
}

export async function buildBookPass2Prompt(
  bookId: string,
  language: string,
  previousResponse: string,
  bookText: string
): Promise<{ prompt: string; promptVersion: number; metadataVersion?: string }> {
  const book = await db.epubFile.findUnique({
    where: { id: bookId },
    include: { bookMetadata: true },
  });
  if (!book) throw new Error("Book not found");

  const { content, version } = await loadBookPass2Template();

  const prompt = fillTemplate(content, {
    title: book.title,
    author: book.author ?? "Unknown",
    language: book.language,
    target_language: language,
    book_text: bookText,
    previous_response: previousResponse,
    expanded_metadata: formatExpandedMetadata(book.bookMetadata),
  });

  return {
    prompt,
    promptVersion: version,
    metadataVersion: book.bookMetadata?.updatedAt.toISOString(),
  };
}
