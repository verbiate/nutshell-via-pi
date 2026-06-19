import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { parseEpub } from "@/server/services/epub-processor";

function coverExtension(mediaType: string | null): string {
  switch ((mediaType || "").toLowerCase()) {
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/svg+xml": return ".svg";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    default: return ".jpg";
  }
}

async function main() {
  const books = await db.epubFile.findMany();
  console.log(`Backfilling covers for ${books.length} book(s)…\n`);

  let updated = 0;
  let skipped = 0;

  for (const book of books) {
    try {
      const epubBuffer = await storage.read(book.epubPath);
      const file = new File([new Uint8Array(epubBuffer)], "book.epub", {
        type: "application/epub+zip",
      });
      const parsed = await parseEpub(file);

      if (!parsed.coverBuffer) {
        console.log(`  ✗ ${book.title.slice(0, 50)} — no cover found`);
        skipped++;
        continue;
      }

      const ext = coverExtension(parsed.coverMediaType);
      const coverPath = await storage.write(
        `covers/${book.md5}${ext}`,
        parsed.coverBuffer
      );
      await db.epubFile.update({
        where: { md5: book.md5 },
        data: { coverPath },
      });
      console.log(
        `  ✓ ${book.title.slice(0, 50)} — ${parsed.coverMediaType} (${parsed.coverBuffer.length} bytes) → ${coverPath}`
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
