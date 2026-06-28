import { db } from "@/server/db";

/**
 * Every book id a user may draw shelf-discussion answers from: the union of
 * their UserBookAccess grants and the books they uploaded. Mirrors the access
 * rule in verifyBookAccess (reader.ts) but returns the full set instead of a
 * boolean — shelf retrieval filters its corpus through this list.
 */
export async function getAccessibleBookIds(userId: string): Promise<string[]> {
  const [granted, uploaded] = await Promise.all([
    db.userBookAccess.findMany({
      where: { userId },
      select: { bookId: true },
    }),
    db.epubFile.findMany({
      where: { uploadedById: userId },
      select: { id: true },
    }),
  ]);
  const set = new Set<string>();
  for (const g of granted) set.add(g.bookId);
  for (const u of uploaded) set.add(u.id);
  return [...set];
}
