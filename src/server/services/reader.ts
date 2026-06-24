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
  percentage?: number;
  ttsChunkAnchor?: string;
} | null> {
  const position = await db.userBookPosition.findUnique({
    where: { userId_bookId: { userId, bookId } },
    select: {
      paragraphIndex: true,
      charOffset: true,
      cfi: true,
      tocSectionId: true,
      percentage: true,
      ttsChunkAnchor: true,
    },
  });
  if (!position) return null;
  return {
    paragraphIndex: position.paragraphIndex,
    charOffset: position.charOffset,
    // Convert Prisma null to undefined to match our return type
    cfi: position.cfi ?? undefined,
    tocSectionId: position.tocSectionId ?? undefined,
    percentage: position.percentage ?? undefined,
    ttsChunkAnchor: position.ttsChunkAnchor ?? undefined,
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
    percentage?: number;
    ttsChunkAnchor?: string;
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
      percentage: data.percentage,
      ttsChunkAnchor: data.ttsChunkAnchor,
    },
    update: {
      paragraphIndex: data.paragraphIndex,
      charOffset: data.charOffset,
      cfi: data.cfi,
      tocSectionId: data.tocSectionId,
      percentage: data.percentage,
      ttsChunkAnchor: data.ttsChunkAnchor,
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

// Bookmarks

export async function getBookmarks(userId: string, bookId: string) {
  return db.bookmark.findMany({
    where: { userId, bookId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createBookmark(
  userId: string,
  bookId: string,
  data: {
    cfi: string;
    paragraphIndex: number;
    charOffset: number;
    pageNumber?: number | null;
    sectionHref?: string;
    note?: string;
  }
) {
  return db.bookmark.create({
    data: {
      userId,
      bookId,
      cfi: data.cfi,
      paragraphIndex: data.paragraphIndex,
      charOffset: data.charOffset,
      pageNumber: data.pageNumber,
      sectionHref: data.sectionHref,
      note: data.note,
    },
  });
}

export async function deleteBookmark(userId: string, bookmarkId: string) {
  const bookmark = await db.bookmark.findUnique({
    where: { id: bookmarkId },
    select: { userId: true },
  });
  if (!bookmark || bookmark.userId !== userId) {
    throw new Error("Bookmark not found or access denied");
  }
  await db.bookmark.delete({ where: { id: bookmarkId } });
}

// Highlights

export async function getHighlights(userId: string, bookId: string) {
  return db.highlight.findMany({
    where: { userId, bookId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createHighlight(
  userId: string,
  bookId: string,
  data: {
    cfi: string;
    paragraphIndex: number;
    charOffsetStart: number;
    charOffsetEnd: number;
    selectedText: string;
    color: string;
    sectionHref?: string;
    pageNumber?: number | null;
    note?: string;
  }
) {
  return db.highlight.create({
    data: {
      userId,
      bookId,
      cfi: data.cfi,
      paragraphIndex: data.paragraphIndex,
      charOffsetStart: data.charOffsetStart,
      charOffsetEnd: data.charOffsetEnd,
      selectedText: data.selectedText,
      color: data.color,
      sectionHref: data.sectionHref,
      pageNumber: data.pageNumber,
      note: data.note,
    },
  });
}

export async function updateHighlight(
  userId: string,
  highlightId: string,
  data: { note?: string; color?: string }
) {
  const highlight = await db.highlight.findUnique({
    where: { id: highlightId },
    select: { userId: true },
  });
  if (!highlight || highlight.userId !== userId) {
    throw new Error("Highlight not found or access denied");
  }
  return db.highlight.update({
    where: { id: highlightId },
    data: {
      ...(data.note !== undefined ? { note: data.note } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
    },
  });
}

export async function deleteHighlight(userId: string, highlightId: string) {
  const highlight = await db.highlight.findUnique({
    where: { id: highlightId },
    select: { userId: true },
  });
  if (!highlight || highlight.userId !== userId) {
    throw new Error("Highlight not found or access denied");
  }
  await db.highlight.delete({ where: { id: highlightId } });
}
