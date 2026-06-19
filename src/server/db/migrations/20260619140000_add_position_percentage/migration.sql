-- AlterTable
-- ponytail: dev.db already has this column from a prior `db push`; this migration
-- exists so fresh clones / production deploys also get it. Marked applied via
-- `prisma migrate resolve --applied` on dev.db.
ALTER TABLE "UserBookPosition" ADD COLUMN "percentage" INTEGER;
