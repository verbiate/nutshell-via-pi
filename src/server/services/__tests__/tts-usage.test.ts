import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    ttsUsage: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/server/services/settings", () => ({
  getSetting: vi.fn(),
}));

import { db } from "@/server/db";
import { getSetting } from "@/server/services/settings";
import {
  getCurrentUsage,
  getEffectiveLimit,
  incrementUsage,
  currentPeriodKey,
} from "@/server/services/tts-usage";

describe("tts-usage", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("currentPeriodKey", () => {
    it("formats UTC year-month with zero-padding", () => {
      expect(currentPeriodKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01");
      expect(currentPeriodKey(new Date(Date.UTC(2026, 10, 15)))).toBe(
        "2026-11"
      );
      expect(currentPeriodKey(new Date(Date.UTC(2026, 11, 31, 23, 59)))).toBe(
        "2026-12"
      );
    });
  });

  describe("getEffectiveLimit", () => {
    it("returns default pro limit when no override", async () => {
      vi.mocked(getSetting).mockResolvedValue(null);
      expect(await getEffectiveLimit("pro")).toBe(50);
    });

    it("returns default admin limit when no override", async () => {
      vi.mocked(getSetting).mockResolvedValue(null);
      expect(await getEffectiveLimit("admin")).toBe(500);
    });

    it("returns 0 for unmetered regular tier", async () => {
      vi.mocked(getSetting).mockResolvedValue(null);
      expect(await getEffectiveLimit("regular")).toBe(0);
    });

    it("returns override value when AppSetting has a number", async () => {
      vi.mocked(getSetting).mockResolvedValue("100");
      expect(await getEffectiveLimit("pro")).toBe(100);
    });

    it("ignores malformed override and falls back to default", async () => {
      vi.mocked(getSetting).mockResolvedValue("not-a-number");
      expect(await getEffectiveLimit("pro")).toBe(50);
    });

    it("ignores negative override", async () => {
      vi.mocked(getSetting).mockResolvedValue("-5");
      expect(await getEffectiveLimit("admin")).toBe(500);
    });

    it("truncates fractional overrides", async () => {
      vi.mocked(getSetting).mockResolvedValue("99.9");
      expect(await getEffectiveLimit("pro")).toBe(99);
    });

    it("returns 0 for unknown userType with no override", async () => {
      vi.mocked(getSetting).mockResolvedValue(null);
      expect(await getEffectiveLimit("ghost")).toBe(0);
    });
  });

  describe("getCurrentUsage", () => {
    it("returns 0 used when no row exists", async () => {
      vi.mocked(getSetting).mockResolvedValue(null);
      vi.mocked(db.ttsUsage.findUnique).mockResolvedValue(null);

      const snap = await getCurrentUsage("u1", "pro");
      expect(snap.used).toBe(0);
      expect(snap.limit).toBe(50);
      expect(snap.periodKey).toMatch(/^\d{4}-\d{2}$/);
      expect(db.ttsUsage.findUnique).toHaveBeenCalledWith({
        where: {
          userId_periodKey: { userId: "u1", periodKey: snap.periodKey },
        },
      });
    });

    it("returns the stored generations count", async () => {
      vi.mocked(getSetting).mockResolvedValue(null);
      vi.mocked(db.ttsUsage.findUnique).mockResolvedValue({
        generations: 37,
      } as any);

      const snap = await getCurrentUsage("u1", "admin");
      expect(snap.used).toBe(37);
      expect(snap.limit).toBe(500);
    });
  });

  describe("incrementUsage", () => {
    it("upserts with create=1 / update=increment=1", async () => {
      vi.mocked(db.ttsUsage.upsert).mockResolvedValue({} as any);

      await incrementUsage("u1");

      expect(db.ttsUsage.upsert).toHaveBeenCalledTimes(1);
      expect(db.ttsUsage.upsert).toHaveBeenCalledWith({
        where: {
          userId_periodKey: {
            userId: "u1",
            periodKey: expect.stringMatching(/^\d{4}-\d{2}$/),
          },
        },
        create: expect.objectContaining({ userId: "u1", generations: 1 }),
        update: { generations: { increment: 1 } },
      });
    });

    it("recovers from P2002 race on create by retrying upsert", async () => {
      const race = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      vi.mocked(db.ttsUsage.upsert)
        .mockRejectedValueOnce(race)
        .mockResolvedValueOnce({} as any);

      await incrementUsage("u1");

      expect(db.ttsUsage.upsert).toHaveBeenCalledTimes(2);
    });

    it("rethrows non-P2002 errors", async () => {
      vi.mocked(db.ttsUsage.upsert).mockRejectedValue(
        Object.assign(new Error("boom"), { code: "P2025" })
      );

      await expect(incrementUsage("u1")).rejects.toThrow("boom");
      expect(db.ttsUsage.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
