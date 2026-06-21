-- Bookmark: drop selectedText (always NULL in practice — bookmarks are
-- position markers, not text spans) and add pageNumber (the epub.js location
-- index captured at save time, displayed as "Page N"). SQLite can't add+drop
-- in one statement cleanly, so Prisma's table-rebuild pattern.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "cfi" TEXT NOT NULL,
    "paragraphIndex" INTEGER NOT NULL,
    "charOffset" INTEGER NOT NULL,
    "pageNumber" INTEGER,
    "sectionHref" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Bookmark_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "EpubFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Bookmark" ("bookId", "cfi", "charOffset", "createdAt", "id", "note", "paragraphIndex", "sectionHref", "userId") SELECT "bookId", "cfi", "charOffset", "createdAt", "id", "note", "paragraphIndex", "sectionHref", "userId" FROM "Bookmark";
DROP TABLE "Bookmark";
ALTER TABLE "new_Bookmark" RENAME TO "Bookmark";
CREATE INDEX "Bookmark_userId_idx" ON "Bookmark"("userId");
CREATE INDEX "Bookmark_bookId_idx" ON "Bookmark"("bookId");
CREATE UNIQUE INDEX "Bookmark_userId_bookId_cfi_key" ON "Bookmark"("userId", "bookId", "cfi");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
