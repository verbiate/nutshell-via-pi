-- CreateTable
-- ponytail: per-user multi-turn explainer threads. Initial response is shared
-- via the existing Explainer cache; only follow-up turns are stored here.
CREATE TABLE "ExplainerThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "explainerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "passageCfi" TEXT,
    "passageText" TEXT,
    "sectionHref" TEXT,
    "language" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    CONSTRAINT "ExplainerThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExplainerThread_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "EpubFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExplainerThread_explainerId_fkey" FOREIGN KEY ("explainerId") REFERENCES "Explainer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ExplainerThread_userId_explainerId_key" ON "ExplainerThread"("userId", "explainerId");
CREATE INDEX "ExplainerThread_userId_bookId_idx" ON "ExplainerThread"("userId", "bookId");

CREATE TABLE "ExplainerMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "modelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExplainerMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ExplainerThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ExplainerMessage_threadId_createdAt_idx" ON "ExplainerMessage"("threadId", "createdAt");
