-- AlterTable: add admin-tunable per-tier token limit
-- ponytail: null = resolve via model context_length lookup, else 128K fallback
ALTER TABLE "OpenRouterConfig" ADD COLUMN "maxContextTokens" INTEGER;

-- CreateTable: admin-visible error log
CREATE TABLE "SystemError" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "userId" TEXT,
    "bookId" TEXT,
    "discussionId" TEXT,
    "context" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "SystemError_createdAt_idx" ON "SystemError"("createdAt");
CREATE INDEX "SystemError_category_resolved_idx" ON "SystemError"("category", "resolved");
