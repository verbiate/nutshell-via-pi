import { PrismaClient } from "@prisma/client";

// ponytail: one-off backfill for the Discussions restructuring. Copies
// contentHash from each thread's pinned explainer onto the thread row, so the
// new version-independent uniqueness [userId, contentHash, language, tier]
// holds for legacy discussions. Safe to re-run (only fills null rows).
// Usage: npx tsx prisma/backfill-thread-content-hash.ts
const prisma = new PrismaClient();

async function main() {
  const threads = await prisma.explainerThread.findMany({
    where: { contentHash: null, explainerId: { not: null } },
    select: { id: true, explainerId: true },
  });
  let n = 0;
  for (const t of threads) {
    if (!t.explainerId) continue;
    const ex = await prisma.explainer.findUnique({
      where: { id: t.explainerId },
      select: { contentHash: true },
    });
    if (ex) {
      await prisma.explainerThread.update({
        where: { id: t.id },
        data: { contentHash: ex.contentHash },
      });
      n++;
    }
  }
  console.log(`Backfilled contentHash on ${n} of ${threads.length} threads.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
