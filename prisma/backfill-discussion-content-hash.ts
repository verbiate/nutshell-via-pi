import { PrismaClient } from "@prisma/client";

// ponytail: one-off backfill for the Discussions restructuring. Copies
// contentHash from each discussion's pinned explainer onto the discussion row,
// so the new version-independent uniqueness [userId, contentHash, language,
// tier] holds for legacy discussions. Safe to re-run (only fills null rows).
// Usage: npx tsx prisma/backfill-discussion-content-hash.ts
const prisma = new PrismaClient();

async function main() {
  const discussions = await prisma.discussion.findMany({
    where: { contentHash: null, explainerId: { not: null } },
    select: { id: true, explainerId: true },
  });
  let n = 0;
  for (const t of discussions) {
    if (!t.explainerId) continue;
    const ex = await prisma.explainer.findUnique({
      where: { id: t.explainerId },
      select: { contentHash: true },
    });
    if (ex) {
      await prisma.discussion.update({
        where: { id: t.id },
        data: { contentHash: ex.contentHash },
      });
      n++;
    }
  }
  console.log(`Backfilled contentHash on ${n} of ${discussions.length} discussions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
