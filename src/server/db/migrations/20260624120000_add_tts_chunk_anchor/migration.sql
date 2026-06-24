-- AlterTable
-- ponytail: stores the leading text of the last TTS chunk spoken so a book
-- reopened after off-reader playback can re-locate the chunk's page without a
-- live CFI. Nullable: manual reading and section-level cloud TTS leave it null.
ALTER TABLE "UserBookPosition" ADD COLUMN "ttsChunkAnchor" TEXT;
