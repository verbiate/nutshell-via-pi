import { db } from "@/server/db";

/**
 * Get all books a user has access to (Personal Library).
 */
export async function getPersonalLibrary(userId: string) {
  return db.userBookAccess.findMany({
    where: { userId },
    include: { book: true },
    orderBy: { createdAt: "desc" },
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
