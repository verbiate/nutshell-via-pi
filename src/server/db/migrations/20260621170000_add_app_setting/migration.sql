-- CreateTable
-- ponytail: KV store for global admin settings (globalSystemPrompt, etc).
-- Applied to dev.db via `prisma db push`; this migration exists for fresh
-- clones / production deploys.
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
