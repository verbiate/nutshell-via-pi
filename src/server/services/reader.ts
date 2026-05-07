/**
 * Reader service: position persistence and book access verification.
 */

import { db } from "@/server/db";

/**
 * Get the saved reading position for a user/book pair.
 * Returns null if no position has been saved yet.
 */
export async function getPosition(
  userId: string,
  bookId: string
): Promise<{
  paragraphIndex: number;
  charOffset: number;
  cfi?: string;
  tocSectionId?: string;
} | null> {
  const position = await db.userBookPosition.findUnique({
    where: { userId_bookId: { userId, bookId } },
    select: {
      paragraphIndex: true,
      charOffset: true,
      cfi: true,
      tocSectionId: true,
    },
  });
  if (!position) return null;
  return {
    paragraphIndex: position.paragraphIndex,
    charOffset: position.charOffset,
    // Convert Prisma null to undefined to match our return type
    cfi: position.cfi ?? undefined,
    tocSectionId: position.tocSectionId ?? undefined,
  };
}

/**
 * Save (upsert) a reading position for a user/book pair.
 *
 * Saves all fields: paragraphIndex, charOffset, and optional cfi + tocSectionId.
 * If a position already exists, updates it.
 */
export async function savePosition(
  userId: string,
  bookId: string,
  data: {
    paragraphIndex: number;
    charOffset: number;
    cfi?: string;
    tocSectionId?: string;
  }
): Promise<void> {
  await db.userBookPosition.upsert({
    where: { userId_bookId: { userId, bookId } },
    create: {
      userId,
      bookId,
      paragraphIndex: data.paragraphIndex,
      charOffset: data.charOffset,
      cfi: data.cfi,
      tocSectionId: data.tocSectionId,
    },
    update: {
      paragraphIndex: data.paragraphIndex,
      charOffset: data.charOffset,
      cfi: data.cfi,
      tocSectionId: data.tocSectionId,
    },
  });
}

/**
 * Verify that a user has access to a specific book.
 * Checks both direct UserBookAccess and whether the user uploaded the book.
 *
 * Returns true if access is granted, false otherwise.
 */
export async function verifyBookAccess(
  userId: string,
  bookId: string
): Promise<boolean> {
  // Check UserBookAccess
  const access = await db.userBookAccess.findUnique({
    where: { userId_bookId: { userId, bookId } },
  });
  if (access) return true;

  // Also grant access if the user uploaded the book
  const book = await db.epubFile.findUnique({
    where: { id: bookId },
    select: { uploadedById: true },
  });
  if (book?.uploadedById === userId) return true;

  return false;
}
