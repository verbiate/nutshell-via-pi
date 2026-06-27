import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { parseEpub } from "@/server/services/epub-processor";

// ponytail: one-off backfill. Some early ingests (pre-2026-06-21 extractor
// rewrite) stored tocJson="[]" for EPUBs that do have a real ToC, so
// {{chapter_index}} resolved empty in both production explainers and the
// Playground. Re-runs the current parseEpub().extractToc over every book whose
// stored tocJson is null/"[]"/unparseable/empty and writes the real ToC back.
// Idempotent: books with a populated ToC are left untouched.
async function main() {
  const books = await db.epubFile.findMany({
    select: { id: true, title: true, epubPath: true, tocJson: true },
    orderBy: { title: "asc" },
  });

  const stale = books.filter((b) => {
    if (!b.epubPath) return false;
    if (!b.tocJson || b.tocJson === "[]") return true;
    try {
      return JSON.parse(b.tocJson).length === 0;
    } catch {
      return true;
    }
  });

  console.log(`Backfilling ToC for ${stale.length} of ${books.length} book(s)…\n`);

  let updated = 0;
  let skipped = 0;

  for (const book of stale) {
    try {
      const epubBuffer = await storage.read(book.epubPath);
      const file = new File([new Uint8Array(epubBuffer)], "book.epub", {
        type: "application/epub+zip",
      });
      const parsed = await parseEpub(file);

      if (parsed.toc.length === 0) {
        console.log(`  · ${book.title.slice(0, 50)} — EPUB genuinely has no ToC`);
        skipped++;
        continue;
      }

      await db.epubFile.update({
        where: { id: book.id },
        data: { tocJson: JSON.stringify(parsed.toc) },
      });
      console.log(
        `  ✓ ${book.title.slice(0, 50)} — ${parsed.toc.length} entries`
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
