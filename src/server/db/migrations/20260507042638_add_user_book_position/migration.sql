-- CreateTable
CREATE TABLE "UserBookPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "paragraphIndex" INTEGER NOT NULL,
    "charOffset" INTEGER NOT NULL,
    "cfi" TEXT,
    "tocSectionId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserBookPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserBookPosition_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "EpubFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UserBookPosition_userId_idx" ON "UserBookPosition"("userId");

-- CreateIndex
CREATE INDEX "UserBookPosition_bookId_idx" ON "UserBookPosition"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBookPosition_userId_bookId_key" ON "UserBookPosition"("userId", "bookId");
