-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "cfi" TEXT NOT NULL,
    "paragraphIndex" INTEGER NOT NULL,
    "charOffset" INTEGER NOT NULL,
    "selectedText" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Bookmark_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "EpubFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Highlight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "cfi" TEXT NOT NULL,
    "paragraphIndex" INTEGER NOT NULL,
    "charOffsetStart" INTEGER NOT NULL,
    "charOffsetEnd" INTEGER NOT NULL,
    "selectedText" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#fbbf24',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Highlight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Highlight_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "EpubFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExplainerRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "explainerId" TEXT NOT NULL,
    "passageCfi" TEXT,
    "passageText" TEXT,
    "sectionHref" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExplainerRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExplainerRequest_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "EpubFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExplainerRequest_explainerId_fkey" FOREIGN KEY ("explainerId") REFERENCES "Explainer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Bookmark_userId_idx" ON "Bookmark"("userId");

-- CreateIndex
CREATE INDEX "Bookmark_bookId_idx" ON "Bookmark"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "Bookmark_userId_bookId_cfi_key" ON "Bookmark"("userId", "bookId", "cfi");

-- CreateIndex
CREATE INDEX "Highlight_userId_idx" ON "Highlight"("userId");

-- CreateIndex
CREATE INDEX "Highlight_bookId_idx" ON "Highlight"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "Highlight_userId_bookId_cfi_key" ON "Highlight"("userId", "bookId", "cfi");

-- CreateIndex
CREATE INDEX "ExplainerRequest_userId_bookId_idx" ON "ExplainerRequest"("userId", "bookId");

-- CreateIndex
CREATE INDEX "ExplainerRequest_createdAt_idx" ON "ExplainerRequest"("createdAt");
