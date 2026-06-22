-- AlterTable
-- ponytail: txt token count populated at ingest (new uploads) or lazy on first
-- playground selection (existing uploads). NULL = "not yet computed".
ALTER TABLE "EpubFile" ADD COLUMN "txtTokens" INTEGER;
