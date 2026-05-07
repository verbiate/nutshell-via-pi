import { storage } from "@/server/storage/local";
import { Book } from "@likecoin/epub-ts";

export async function extractSectionText(
  epubPath: string,
  sectionHref: string
): Promise<string> {
  const epubBuffer = await storage.read(epubPath);

  // Convert Node.js Buffer to ArrayBuffer for @likecoin/epub-ts
  const arrayBuffer = epubBuffer.buffer.slice(
    epubBuffer.byteOffset,
    epubBuffer.byteOffset + epubBuffer.byteLength
  ) as ArrayBuffer;

  const book = new Book();
  await book.open(arrayBuffer);

  try {
    // Strip fragment from href for spine lookup
    const cleanHref = sectionHref.split("#")[0];

    const spineItem = book.spine.get(cleanHref);
    if (!spineItem) {
      throw new Error(`Section not found in EPUB spine: ${sectionHref}`);
    }

    const doc = (await spineItem.load()) as unknown as { textContent: string | null; body: { textContent: string | null } | null };
    const text = doc.body?.textContent ?? doc.textContent ?? "";
    return text.trim();
  } finally {
    book.destroy();
  }
}
