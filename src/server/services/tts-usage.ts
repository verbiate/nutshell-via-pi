import { db } from "@/server/db";
import { getSetting } from "@/server/services/settings";

// ponytail: monthly quota counter for cloud TTS. periodKey = "YYYY-MM" so the
// counter rolls over each calendar month without a cron job — a new month just
// starts a new row. Defaults live here; admins override via AppSetting key
// `tts.quota.<userType>.generations`. Only pro/admin are metered; "regular"
// has no cloud access (browser TTS is unmetered) so its default is 0.

const DEFAULT_LIMITS: Record<string, number> = {
  regular: 0,
  pro: 50,
  admin: 500,
};

/** "YYYY-MM" for the current UTC month. Pure so tests can stub Date. */
export function currentPeriodKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getEffectiveLimit(userType: string): Promise<number> {
  const override = await getSetting(`tts.quota.${userType}.generations`);
  if (override != null && override !== "") {
    const n = Number(override);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
  return DEFAULT_LIMITS[userType] ?? 0;
}

export interface UsageSnapshot {
  used: number;
  limit: number;
  periodKey: string;
}

export async function getCurrentUsage(
  userId: string,
  userType: string
): Promise<UsageSnapshot> {
  const periodKey = currentPeriodKey();
  const [row, limit] = await Promise.all([
    db.ttsUsage.findUnique({ where: { userId_periodKey: { userId, periodKey } } }),
    getEffectiveLimit(userType),
  ]);
  return { used: row?.generations ?? 0, limit, periodKey };
}

/**
 * Increment the user's counter for the current period. Idempotent row creation
 * via upsert; if two concurrent calls race to create the row, the loser hits
 * P2002 on the create branch — fall back to an update increment.
 */
export async function incrementUsage(userId: string): Promise<void> {
  const periodKey = currentPeriodKey();
  try {
    await db.ttsUsage.upsert({
      where: { userId_periodKey: { userId, periodKey } },
      create: { userId, periodKey, generations: 1 },
      update: { generations: { increment: 1 } },
    });
  } catch (err: any) {
    // ponytail: P2002 = unique constraint violation — concurrent create won the
    // race. Re-read and increment so the count is still correct. If the row
    // vanished between calls (delete race), treat as create.
    if (err?.code === "P2002") {
      await db.ttsUsage.upsert({
        where: { userId_periodKey: { userId, periodKey } },
        create: { userId, periodKey, generations: 1 },
        update: { generations: { increment: 1 } },
      });
      return;
    }
    throw err;
  }
}
