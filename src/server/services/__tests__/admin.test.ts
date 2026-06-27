import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    promptTemplate: { upsert: vi.fn() },
    promptPreset: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/server/services/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/server/db";
import {
  updateBookTwoPassEnabled,
  getPromptPresets,
  createPromptPreset,
  updatePromptPreset,
  deletePromptPreset,
} from "@/server/services/admin";

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

describe("Prompt Presets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists presets, scoped by type when given", async () => {
    (db.promptPreset.findMany as any).mockResolvedValue([]);
    await getPromptPresets("book");
    expect(db.promptPreset.findMany).toHaveBeenCalledWith({
      where: { type: "book" },
      orderBy: [{ name: "asc" }],
    });

    await getPromptPresets();
    expect(db.promptPreset.findMany).toHaveBeenLastCalledWith({
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
  });

  it("creates a preset and audits PROMPT_PRESET_CREATED", async () => {
    (db.promptPreset.create as any).mockResolvedValue({
      id: "p1",
      type: "book",
      name: " terse",
    });
    await createPromptPreset("admin1", {
      type: "book",
      name: "  terse  ",
      content: "be brief",
    });

    // name is trimmed before persist
    expect(db.promptPreset.create).toHaveBeenCalledWith({
      data: { type: "book", name: "terse", content: "be brief" },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: "admin1",
        action: "PROMPT_PRESET_CREATED",
        entityType: "prompt_preset",
        entityId: "p1",
      }),
    });
  });

  it("rejects an invalid preset type", async () => {
    await expect(
      createPromptPreset("admin1", {
        type: "nonsense",
        name: "x",
        content: "y",
      })
    ).rejects.toThrow("Invalid preset type");
    expect(db.promptPreset.create).not.toHaveBeenCalled();
  });

  it("updates a preset only when it exists", async () => {
    (db.promptPreset.findUnique as any).mockResolvedValue(null);
    await expect(
      updatePromptPreset("admin1", "p1", { content: "x" })
    ).rejects.toThrow("Preset not found");

    (db.promptPreset.findUnique as any).mockResolvedValue({
      id: "p1",
      name: "old",
    });
    await updatePromptPreset("admin1", "p1", { content: "new" });
    expect(db.promptPreset.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { content: "new" },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PROMPT_PRESET_UPDATED",
        entityId: "p1",
      }),
    });
  });

  it("deletes a preset and audits", async () => {
    (db.promptPreset.findUnique as any).mockResolvedValue({
      id: "p1",
      type: "book",
      name: "terse",
    });
    await deletePromptPreset("admin1", "p1");
    expect(db.promptPreset.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PROMPT_PRESET_DELETED",
        entityId: "p1",
      }),
    });
  });
});
