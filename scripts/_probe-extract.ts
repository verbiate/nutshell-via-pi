import { extractBookConcepts } from "@/server/services/shelf-knowledge/extract";
import { db } from "@/server/db";
(async () => {
  const book = await db.epubFile.findUnique({
    where: { id: "cmqk6xu64000hvesrg03rth3w" },
    include: { bookMetadata: true },
  });
  if (!book) { console.log("book not found"); process.exit(1); }
  console.log(`Probing: "${book.title}" (${book.txtTokens} tokens, isNarrative=${book.bookMetadata?.isNarrative})`);
  const t0 = Date.now();
  const result = await extractBookConcepts(book as any);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== ${result.concepts.length} concepts in ${secs}s | topic="${result.topic}" | form=${result.form} ===\n`);
  for (const c of result.concepts) {
    console.log(`• [${c.conceptType}] ${c.title}`);
    for (const [k, v] of Object.entries(c.bodyFields)) {
      const preview = v.length > 180 ? v.slice(0, 180) + "…" : v;
      console.log(`    ${k}: ${preview}`);
    }
    if (c.relatedConceptNames.length) console.log(`    related: ${c.relatedConceptNames.join(", ")}`);
    console.log();
  }
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
