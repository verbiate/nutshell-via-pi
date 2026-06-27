import { db } from "@/server/db";

// ponytail: single helper for recording admin-visible errors. Called from
// failure paths in the explainer pipeline and the upload pipeline. Generic
// shape — `category` discriminates; `context` (JSON string) carries details.

export interface RecordErrorInput {
  category: string;     // e.g. "explainer_too_large", "upload_blocked", "openrouter_error"
  message: string;
  userId?: string;
  bookId?: string;
  discussionId?: string;
  context?: Record<string, unknown>;  // serialized to JSON
}

export async function recordError(input: RecordErrorInput): Promise<void> {
  try {
    await db.systemError.create({
      data: {
        category: input.category,
        message: input.message,
        userId: input.userId ?? null,
        bookId: input.bookId ?? null,
        discussionId: input.discussionId ?? null,
        context: input.context ? JSON.stringify(input.context) : null,
      },
    });
  } catch (err) {
    // ponytail: never let error-recording itself throw — would mask the
    // original error. Log and move on.
    console.error("[recordError] failed to persist:", err);
  }
}

export async function listErrors(params: {
  resolved?: boolean;
  category?: string;
  limit?: number;
  cursor?: string;  // createdAt of last item, for keyset pagination
}): Promise<{ errors: Array<Record<string, unknown>>; nextCursor: string | null }> {
  const limit = Math.min(params.limit ?? 50, 200);
  const where: Record<string, unknown> = {};
  if (typeof params.resolved === "boolean") {
    where.resolved = params.resolved;
  }
  if (params.category) {
    where.category = params.category;
  }

  const rows = await db.systemError.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? slice[slice.length - 1].createdAt.toISOString() : null;

  return {
    errors: slice.map((r) => ({
      id: r.id,
      category: r.category,
      message: r.message,
      userId: r.userId,
      bookId: r.bookId,
      discussionId: r.discussionId,
      context: r.context,
      resolved: r.resolved,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor,
  };
}

export async function resolveError(id: string): Promise<void> {
  await db.systemError.update({
    where: { id },
    data: { resolved: true },
  });
}

export async function countUnresolved(): Promise<number> {
  return db.systemError.count({ where: { resolved: false } });
}
