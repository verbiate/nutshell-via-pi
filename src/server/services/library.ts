import { db } from "@/server/db";

/**
 * Get all books a user has access to (Personal Library), with reading progress.
 */
export async function getPersonalLibrary(userId: string) {
  const [accesses, positions] = await Promise.all([
    db.userBookAccess.findMany({
      where: { userId },
      include: { book: true },
      orderBy: { createdAt: "desc" },
    }),
    db.userBookPosition.findMany({
      where: { userId },
    }),
  ]);

  const positionMap = new Map(positions.map((p) => [p.bookId, p]));

  // Sort by most recently opened (position.updatedAt), falling back to when the
  // book was added to the user's library (access.createdAt). The DB's createdAt
  // desc ordering is the deterministic tiebreaker for equal timestamps.
  return accesses
    .slice()
    .sort((a, b) => {
      const aMs = (positionMap.get(a.book.id)?.updatedAt ?? a.createdAt).getTime();
      const bMs = (positionMap.get(b.book.id)?.updatedAt ?? b.createdAt).getTime();
      return bMs - aMs;
    })
    .map((access) => {
      const position = positionMap.get(access.book.id);
      // Progress is sourced from the percentage persisted by the reader (computed
      // from epub.js locations), not from paragraphIndex — that field is an
      // unreliable placeholder and totalParagraphs doesn't account for reflow.
      const progress = position?.percentage ?? null;
      // Show the bar only for books opened past the very start (≥1%).
      const hasProgress = position != null && (position.percentage ?? 0) >= 1;

      return {
        id: access.book.id,
        title: access.book.title,
        author: access.book.author,
        language: access.book.language,
        coverPath: access.book.coverPath,
        progress,
        hasProgress,
      };
    });
}

/**
 * Get all books in the Universal Library (admin only).
 */
export async function getUniversalLibrary(page = 1, pageSize = 20) {
  const skip = (page - 1) * pageSize;
  const [books, total] = await Promise.all([
    db.epubFile.findMany({
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { userAccesses: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.epubFile.count(),
  ]);

  return { books, total, page, pageSize };
}

/**
 * Get a single book by ID with access check.
 */
export async function getBookForUser(bookId: string, userId: string) {
  const access = await db.userBookAccess.findUnique({
    where: { userId_bookId: { userId, bookId } },
    include: {
      book: {
        include: {
          // ponytail: 1:1 relation — bookMetadata only exists after admin
          // extraction. Selecting just `description` keeps the row cheap.
          bookMetadata: { select: { description: true } },
        },
      },
    },
  });
  return access?.book || null;
}

/**
 * Get a single book by ID (no access check — admin use).
 */
export async function getBookById(bookId: string) {
  return db.epubFile.findUnique({
    where: { id: bookId },
    include: {
      uploadedBy: { select: { id: true, name: true, email: true } },
      _count: { select: { userAccesses: true } },
    },
  });
}
