-- CreateTable
-- ponytail: per-user multi-turn discussions. The initial response is shared
-- via the existing Explainer cache; only follow-up turns are stored here.
CREATE TABLE "Discussion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
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

CREATE INDEX "Discussion_userId_bookId_idx" ON "Discussion"("userId", "bookId");

CREATE UNIQUE INDEX "Discussion_userId_contentHash_language_tier_key" ON "Discussion"("userId", "contentHash", "language", "tier");

CREATE TABLE "DiscussionMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "modelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionMessage_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DiscussionMessage_discussionId_createdAt_idx" ON "DiscussionMessage"("discussionId", "createdAt");
