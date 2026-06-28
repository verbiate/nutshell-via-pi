import { extractBookConcepts } from "@/server/services/shelf-knowledge/extract";
import { clusterByTopic } from "@/server/services/shelf-knowledge/cluster";
import { synthesizeClusterTheme } from "@/server/services/shelf-knowledge/synthesize";
import { conceptToMarkdown, conceptRelPath } from "@/server/services/shelf-knowledge/render";
import { db } from "@/server/db";
const IDS = ["cmqk6xmz50005vesr655325kk","cmqk6xqb80009vesrrs2aptb4","cmqk6xs37000dvesr4wudlo0t"];
(async () => {
  const perBook = [];
  for (const id of IDS) {
    const book = await db.epubFile.findUnique({ where: { id }, include: { bookMetadata: true } }) as any;
    if (!book) continue;
    const t0 = Date.now();
    const r = await extractBookConcepts(book);
    console.log(`"${book.title.slice(0,38)}": ${r.concepts.length} concepts | topic="${r.topic}" | ${((Date.now()-t0)/1000).toFixed(0)}s`);
    perBook.push({ bookId: id, bookTitle: book.title, concepts: r.concepts, topic: r.topic });
  }
  const clusters = clusterByTopic(perBook.map(b => ({ bookId: b.bookId, topic: b.topic })));
  console.log(`\nclusters(>=2): ${clusters.length} -> ${clusters.map(c=>`"${c.topic}"(${c.bookIds.length})`).join(", ")}`);
  const all = perBook.flatMap(b=>b.concepts);
  const known = new Set(all.map(c=>conceptRelPath(c)));
  for (const cl of clusters) {
    const bc = perBook.filter(b=>cl.bookIds.includes(b.bookId)).map(b=>({bookId:b.bookId,bookTitle:b.bookTitle,concepts:b.concepts}));
    const t = await synthesizeClusterTheme({ topic: cl.topic, bookConcepts: bc });
    console.log(`\nTHEME [${cl.topic}]: "${t.title}"`);
    console.log(`  summary: ${t.summary}`);
    console.log(`  links: ${t.relatedConceptIds.filter(x=>known.has(x)).length}/${t.relatedConceptIds.length} valid`);
  }
  const c = all[0];
  if (c) { const cm = conceptToMarkdown(c); console.log(`\nsample concept ${cm.relPath}:\n${cm.body.slice(0,300)}`); }
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message?.slice(0,400)); process.exit(1); });
