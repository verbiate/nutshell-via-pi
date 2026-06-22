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
export interface BuiltPrompt {
  prompt: string;
  sourceText: string;     // the chosen snippet (book/section/passage)
  bookText: string;       // the full book plaintext (== sourceText for book type)
  bookMd5: string;        // unique book identifier for cache keying
  promptVersion: number;
}

async function loadBookText(txtPath: string): Promise<string> {
  const txtBuffer = await storage.read(txtPath);
  return txtBuffer.toString("utf-8");
}

export async function buildBookPrompt(
  bookId: string,
  language: string
): Promise<BuiltPrompt> {
  const book = await db.epubFile.findUnique({ where: { id: bookId } });
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
  });

  return {
    prompt,
    sourceText,
    bookText: sourceText,
    bookMd5: book.md5,
    promptVersion: template.version,
  };
}

export async function buildSectionPrompt(
  bookId: string,
  sectionHref: string,
  language: string
): Promise<BuiltPrompt & { sectionTitle: string }> {
  const book = await db.epubFile.findUnique({ where: { id: bookId } });
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
  });

  return {
    prompt,
    sourceText: sectionText,
    bookText,
    bookMd5: book.md5,
    promptVersion: template.version,
    sectionTitle,
  };
}

export async function buildPassagePrompt(
  bookId: string,
  passageText: string,
  language: string
): Promise<BuiltPrompt> {
  const book = await db.epubFile.findUnique({ where: { id: bookId } });
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
  });

  return {
    prompt,
    sourceText: passageText,
    bookText,
    bookMd5: book.md5,
    promptVersion: template.version,
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
): Promise<{ prompt: string; promptVersion: number }> {
  const book = await db.epubFile.findUnique({ where: { id: bookId } });
  if (!book) throw new Error("Book not found");

  const { content, version } = await loadBookPass2Template();

  const prompt = fillTemplate(content, {
    title: book.title,
    author: book.author ?? "Unknown",
    language: book.language,
    target_language: language,
    book_text: bookText,
    previous_response: previousResponse,
  });

  return { prompt, promptVersion: version };
}
