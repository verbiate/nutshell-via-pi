-- drop the column DEFAULT on Highlight.color (color is now required and
-- always supplied by the application; there is no default highlight color).
-- SQLite can't DROP DEFAULT in place, so Prisma redefines the table.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Highlight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "cfi" TEXT NOT NULL,
    "paragraphIndex" INTEGER NOT NULL,
    "charOffsetStart" INTEGER NOT NULL,
    "charOffsetEnd" INTEGER NOT NULL,
    "selectedText" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sectionHref" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Highlight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Highlight_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "EpubFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Highlight" ("bookId", "cfi", "charOffsetEnd", "charOffsetStart", "color", "createdAt", "id", "note", "paragraphIndex", "sectionHref", "selectedText", "userId") SELECT "bookId", "cfi", "charOffsetEnd", "charOffsetStart", "color", "createdAt", "id", "note", "paragraphIndex", "sectionHref", "selectedText", "userId" FROM "Highlight";
DROP TABLE "Highlight";
ALTER TABLE "new_Highlight" RENAME TO "Highlight";
CREATE INDEX "Highlight_userId_idx" ON "Highlight"("userId");
CREATE INDEX "Highlight_bookId_idx" ON "Highlight"("bookId");
CREATE UNIQUE INDEX "Highlight_userId_bookId_cfi_key" ON "Highlight"("userId", "bookId", "cfi");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
