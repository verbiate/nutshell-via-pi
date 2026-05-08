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

  return accesses.map((access) => {
    const position = positionMap.get(access.book.id);
    const totalParagraphs = access.book.totalParagraphs;
    const progress =
      totalParagraphs && totalParagraphs > 0 && position
        ? Math.min(100, Math.round((position.paragraphIndex / totalParagraphs) * 100))
        : null;

    return {
      id: access.book.id,
      title: access.book.title,
      author: access.book.author,
      language: access.book.language,
      coverPath: access.book.coverPath,
      progress,
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
    include: { book: true },
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
