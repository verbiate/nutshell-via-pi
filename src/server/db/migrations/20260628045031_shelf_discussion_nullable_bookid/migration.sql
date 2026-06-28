-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Discussion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT,
    "explainerId" TEXT,
    "contentHash" TEXT,
    "type" TEXT NOT NULL,
    "passageCfi" TEXT,
    "passageText" TEXT,
    "sectionHref" TEXT,
    "language" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "initialCacheHit" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Discussion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Discussion_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "EpubFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Discussion_explainerId_fkey" FOREIGN KEY ("explainerId") REFERENCES "Explainer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Discussion" ("bookId", "contentHash", "createdAt", "explainerId", "id", "initialCacheHit", "language", "passageCfi", "passageText", "sectionHref", "tier", "type", "updatedAt", "userId") SELECT "bookId", "contentHash", "createdAt", "explainerId", "id", "initialCacheHit", "language", "passageCfi", "passageText", "sectionHref", "tier", "type", "updatedAt", "userId" FROM "Discussion";
DROP TABLE "Discussion";
ALTER TABLE "new_Discussion" RENAME TO "Discussion";
CREATE INDEX "Discussion_userId_bookId_idx" ON "Discussion"("userId", "bookId");
CREATE UNIQUE INDEX "Discussion_userId_contentHash_language_tier_key" ON "Discussion"("userId", "contentHash", "language", "tier");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

