import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    promptTemplate: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/server/services/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/server/db";
import { updateBookTwoPassEnabled } from "@/server/services/admin";

describe("updateBookTwoPassEnabled", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates book_pass2 template when enabling so the next explainer can't 500", async () => {
    // Regression guard: flipping the toggle on without seeding used to leave
    // buildBookPass2Prompt with no row, surfacing "book_pass2 prompt template
    // not found" to the reader. The enable path must seed it. Version tracks
    // the seed (prisma/seed.ts) so the contentHash salt stays consistent.
    await updateBookTwoPassEnabled("admin1", true);

    expect(db.promptTemplate.upsert).toHaveBeenCalledWith({
      where: { type: "book_pass2" },
      update: {}, // ponytail: must NOT overwrite an admin-edited template
      create: expect.objectContaining({
        type: "book_pass2",
        content: expect.stringContaining("{{previous_response}}"),
        version: 2,
      }),
    });
  });

  it("does not touch the template when disabling", async () => {
    await updateBookTwoPassEnabled("admin1", false);
    expect(db.promptTemplate.upsert).not.toHaveBeenCalled();
  });

  it("audits the toggle change", async () => {
    await updateBookTwoPassEnabled("admin1", true);
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: "admin1",
        action: "BOOK_TWOPASS_TOGGLED",
        newValue: "true",
      }),
    });
  });
});
