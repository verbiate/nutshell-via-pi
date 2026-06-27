import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { countTokens } from "@/server/services/tokens";

// ponytail: populate EpubFile.txtTokens for books missing it, by counting the
// already-extracted .txt (no EPUB re-parse). This unblocks the discussion
// "attach another book" size guard + the "X% full" context indicator for
// attached books. Idempotent — skips books that already have a count.
async function main() {
  const books = await db.epubFile.findMany({ select: { id: true, title: true, txtPath: true, txtTokens: true } });
  const missing = books.filter((b) => b.txtTokens == null);
  console.log(`${books.length} book(s); ${missing.length} missing txtTokens.\n`);

  let updated = 0;
  let skipped = 0;
  for (const book of missing) {
    try {
      const buf = await storage.read(book.txtPath);
      const text = buf.toString("utf-8");
      const txtTokens = countTokens(text);
      await db.epubFile.update({ where: { id: book.id }, data: { txtTokens } });
      console.log(`  ✓ ${book.title.slice(0, 50)} — ${txtTokens.toLocaleString()} tokens`);
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
