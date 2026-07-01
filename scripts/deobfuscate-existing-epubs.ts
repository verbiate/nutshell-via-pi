import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { deobfuscateEpubFonts } from "@/server/services/font-deobfuscation";

// One-off: deobfuscate embedded fonts in already-stored epubs. New uploads do
// this at ingest (epub-processor.ts), but books uploaded before that path
// landed retain their obfuscated fonts → render as Times under "Publisher".
//
//   npx tsx scripts/deobfuscate-existing-epubs.ts
//
// Idempotent: books with no font obfuscation are returned untouched by the
// service and skipped here with no write.
async function main() {
  const books = await db.epubFile.findMany();
  console.log(`Scanning ${books.length} book(s) for obfuscated fonts…\n`);

  let cleaned = 0;
  let untouched = 0;

  for (const book of books) {
    const label = book.title.slice(0, 50);
    try {
      const original = await storage.read(book.epubPath);
      const cleanedBuf = await deobfuscateEpubFonts(original);
      if (cleanedBuf.length === original.length && cleanedBuf.equals(original)) {
        untouched++;
        continue;
      }
      await storage.write(book.epubPath, cleanedBuf);
      console.log(`  ✓ ${label} — deobfuscated (${original.length} → ${cleanedBuf.length} bytes)`);
      cleaned++;
    } catch (err: any) {
      console.log(`  ! ${label} — ERROR: ${err.message}`);
      untouched++;
    }
  }

  console.log(`\nDone. Cleaned ${cleaned}, untouched ${untouched}.`);
}

main()
  .catch((err) => {
    console.error("Deobfuscation backfill failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
