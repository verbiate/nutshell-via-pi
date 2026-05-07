-- CreateTable
CREATE TABLE "Explainer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentHash" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "contentType" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'regular',
    "content" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "tokenCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'regular',
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "emailVerified", "id", "image", "name", "role", "updatedAt") SELECT "createdAt", "email", "emailVerified", "id", "image", "name", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Explainer_contentHash_idx" ON "Explainer"("contentHash");

-- CreateIndex
CREATE INDEX "Explainer_createdAt_idx" ON "Explainer"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Explainer_contentHash_language_contentType_tier_key" ON "Explainer"("contentHash", "language", "contentType", "tier");
