import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => {
  const mockDb = {
    playlistItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: typeof mockDb) => unknown) => cb(mockDb)),
  };
  return { db: mockDb };
});

import { db } from "@/server/db";
import {
  getPlaylist,
  addItem,
  activateItem,
  removeItem,
  clearPlaylist,
  reorderUpcoming,
  getAutoAdvance,
  setAutoAdvance,
} from "@/server/services/playlist";

function makeItem(
  overrides: Partial<{
    id: string;
    userId: string;
    position: number;
    status: string;
    playedAt: Date | null;
  }> = {},
) {
  return {
    id: overrides.id ?? "id",
    userId: overrides.userId ?? "u1",
    bookId: "b1",
    sectionHref: "ch1.xhtml",
    sectionLabel: "Chapter 1",
    position: overrides.position ?? 0,
    status: overrides.status ?? "upcoming",
    bookTitle: "Book" as string | null,
    bookAuthor: null as string | null,
    bookCoverPath: null as string | null,
    bookLanguage: "en",
    addedAt: new Date("2026-01-01T00:00:00.000Z"),
    playedAt: overrides.playedAt ?? null,
  };
}

describe("Playlist service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.$transaction).mockImplementation(async (cb: (tx: typeof db) => unknown) => cb(db));
    vi.mocked(db.playlistItem.findMany).mockResolvedValue([]);
    vi.mocked(db.playlistItem.findFirst).mockResolvedValue(null);
  });

  it("getPlaylist returns ordered items with ISO date strings", async () => {
    vi.mocked(db.playlistItem.findMany).mockResolvedValue([
      makeItem({ id: "i1", position: 0 }),
      makeItem({ id: "i2", position: 1 }),
    ] as any);

    const result = await getPlaylist("u1");
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("i1");
    expect(result[0].addedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(db.playlistItem.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: { position: "asc" },
    });
  });

  it("addItem with mode='last' appends at the end", async () => {
    vi.mocked(db.playlistItem.findFirst).mockResolvedValue(null as any);
    vi.mocked(db.playlistItem.findFirst)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ position: 2 } as any);
    vi.mocked(db.playlistItem.count).mockResolvedValue(0);
    vi.mocked(db.playlistItem.create).mockResolvedValue(
      makeItem({ id: "new", position: 3 }) as any,
    );

    const item = await addItem("u1", {
      bookId: "b1",
      sectionHref: "ch4.xhtml",
      sectionLabel: "Chapter 4",
      mode: "last",
    });

    expect(item.position).toBe(3);
    expect(db.playlistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 3, status: "upcoming" }),
      }),
    );
  });

  it("addItem with mode='next' inserts after the active item", async () => {
    vi.mocked(db.playlistItem.findFirst)
      .mockResolvedValueOnce(makeItem({ id: "active", position: 2, status: "active" }) as any)
      .mockResolvedValueOnce({ position: 5 } as any);
    vi.mocked(db.playlistItem.count).mockResolvedValue(3);
    vi.mocked(db.playlistItem.create).mockResolvedValue(
      makeItem({ id: "new", position: 3 }) as any,
    );

    await addItem("u1", {
      bookId: "b1",
      sectionHref: "ch4.xhtml",
      sectionLabel: "Chapter 4",
      mode: "next",
    });

    expect(db.playlistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 3 }),
      }),
    );
  });

  it("activateItem makes target active and prior items history", async () => {
    vi.mocked(db.playlistItem.findUnique).mockResolvedValue(
      makeItem({ id: "target", position: 2, status: "upcoming" }) as any,
    );
    vi.mocked(db.playlistItem.findMany).mockResolvedValue([
      makeItem({ id: "i0", position: 0, status: "history" }),
      makeItem({ id: "i1", position: 1, status: "upcoming" }),
      makeItem({ id: "target", position: 2, status: "upcoming" }),
      makeItem({ id: "i3", position: 3, status: "upcoming" }),
    ] as any);
    vi.mocked(db.playlistItem.count).mockResolvedValue(4);
    vi.mocked(db.playlistItem.findUniqueOrThrow).mockResolvedValue(
      makeItem({ id: "target", position: 2, status: "active" }) as any,
    );

    await activateItem("u1", "target");

    expect(db.playlistItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i1" },
        data: expect.objectContaining({ status: "history" }),
      }),
    );
    expect(db.playlistItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "target" },
        data: expect.objectContaining({ status: "active", playedAt: null }),
      }),
    );
  });

  it("removeItem deletes and compacts positions", async () => {
    vi.mocked(db.playlistItem.findUnique).mockResolvedValue(
      makeItem({ id: "i1", position: 1 }) as any,
    );
    vi.mocked(db.playlistItem.findMany).mockResolvedValue([
      makeItem({ id: "i2", position: 2 }),
      makeItem({ id: "i3", position: 3 }),
    ] as any);

    await removeItem("u1", "i1");

    expect(db.playlistItem.delete).toHaveBeenCalledWith({ where: { id: "i1" } });
    expect(db.playlistItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i2" },
        data: { position: 1 },
      }),
    );
    expect(db.playlistItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i3" },
        data: { position: 2 },
      }),
    );
  });

  it("clearPlaylist('upcoming') removes upcoming and compacts", async () => {
    await clearPlaylist("u1", "upcoming");

    expect(db.playlistItem.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", status: "upcoming" },
    });
  });

  it("clearPlaylist('all') removes everything", async () => {
    await clearPlaylist("u1", "all");

    expect(db.playlistItem.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
    });
  });

  it("reorderUpcoming rewrites positions after active", async () => {
    vi.mocked(db.playlistItem.findFirst).mockResolvedValue(
      makeItem({ id: "active", position: 2, status: "active" }) as any,
    );
    vi.mocked(db.playlistItem.findMany).mockResolvedValue([
      makeItem({ id: "u1", position: 3, status: "upcoming" }),
      makeItem({ id: "u2", position: 4, status: "upcoming" }),
    ] as any);

    await reorderUpcoming("u1", ["u2", "u1"]);

    expect(db.playlistItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u2" },
        data: { position: 3 },
      }),
    );
    expect(db.playlistItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: { position: 4 },
      }),
    );
  });

  it("getAutoAdvance returns user setting", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      playlistAutoAdvance: false,
    } as any);

    const value = await getAutoAdvance("u1");
    expect(value).toBe(false);
  });

  it("setAutoAdvance updates user", async () => {
    await setAutoAdvance("u1", true);

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { playlistAutoAdvance: true },
    });
  });
});
