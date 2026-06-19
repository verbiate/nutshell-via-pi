import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { parseEpub } from "@/server/services/epub-processor";

async function main() {
  const books = await db.epubFile.findMany();
  console.log(`Backfilling text + totalParagraphs for ${books.length} book(s)…\n`);

  let updated = 0;
  let skipped = 0;

  for (const book of books) {
    try {
      const epubBuffer = await storage.read(book.epubPath);
      const file = new File([new Uint8Array(epubBuffer)], "book.epub", {
        type: "application/epub+zip",
      });
      const parsed = await parseEpub(file);

      if (!parsed.text) {
        console.log(`  ✗ ${book.title.slice(0, 50)} — no text extracted`);
        skipped++;
        continue;
      }

      const totalParagraphs = parsed.text.split("\n\n").length;
      const txtPath = await storage.write(`txts/${book.md5}.txt`, parsed.text);
      await db.epubFile.update({
        where: { md5: book.md5 },
        data: { txtPath, totalParagraphs },
      });
      console.log(
        `  ✓ ${book.title.slice(0, 50)} — ${parsed.text.length.toLocaleString()} chars, ${totalParagraphs.toLocaleString()} paragraphs → ${txtPath}`
      );
      updated++;
    } catch (err: any) {
      console.log(`  ! ${book.title.slice(0, 50)} — ERROR: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped}.`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
