import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { extractSectionText } from "./section-extractor";

export function fillTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export async function buildBookPrompt(
  bookId: string,
  language: string
): Promise<{ prompt: string; sourceText: string; promptVersion: number }> {
  const book = await db.epubFile.findUnique({ where: { id: bookId } });
  if (!book) throw new Error("Book not found");

  const template = await db.promptTemplate.findUnique({ where: { type: "book" } });
  if (!template) throw new Error("Book prompt template not found");

  const txtBuffer = await storage.read(book.txtPath);
  const sourceText = txtBuffer.toString("utf-8");

  const prompt = fillTemplate(template.content, {
    title: book.title,
    author: book.author ?? "Unknown",
    language: book.language,
    target_language: language,
    text: sourceText,
  });

  return { prompt, sourceText, promptVersion: template.version };
}

export async function buildSectionPrompt(
  bookId: string,
  sectionHref: string,
  language: string
): Promise<{ prompt: string; sourceText: string; promptVersion: number; sectionTitle: string }> {
  const book = await db.epubFile.findUnique({ where: { id: bookId } });
  if (!book) throw new Error("Book not found");

  const template = await db.promptTemplate.findUnique({ where: { type: "section" } });
  if (!template) throw new Error("Section prompt template not found");

  const sectionText = await extractSectionText(book.epubPath, sectionHref);

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
    text: sectionText,
  });

  return { prompt, sourceText: sectionText, promptVersion: template.version, sectionTitle };
}
