import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    userBookAccess: {
      findMany: vi.fn(),
    },
    userBookPosition: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/server/db";
import { getPersonalLibrary } from "@/server/services/library";

describe("POL-02: getPersonalLibrary progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeAccess(
    bookOverrides: Record<string, unknown> = {},
    accessOverrides: Record<string, unknown> = {},
  ) {
    return {
      book: {
        id: "book-1",
        title: "Test Book",
        author: "Author",
        language: "en",
        coverPath: null,
        totalParagraphs: 100,
        ...bookOverrides,
      },
      createdAt: new Date(),
      ...accessOverrides,
    };
  }

  it("uses the persisted percentage as progress", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([makeAccess()] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      { bookId: "book-1", percentage: 50 },
    ] as any);

    const result = await getPersonalLibrary("user-1");
    expect(result).toHaveLength(1);
    expect(result[0].progress).toBe(50);
  });

  it("returns null progress when user has no position", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([makeAccess()] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([] as any);

    const result = await getPersonalLibrary("user-1");
    expect(result[0].progress).toBeNull();
  });

  it("returns null progress when percentage is not yet persisted", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([makeAccess()] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      { bookId: "book-1", paragraphIndex: 5 }, // no percentage field
    ] as any);

    const result = await getPersonalLibrary("user-1");
    expect(result[0].progress).toBeNull();
  });

  it("returns 100 progress when complete", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([makeAccess()] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      { bookId: "book-1", percentage: 100 },
    ] as any);

    const result = await getPersonalLibrary("user-1");
    expect(result[0].progress).toBe(100);
  });

  it("returns 0 progress when at start", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([makeAccess()] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      { bookId: "book-1", percentage: 0 },
    ] as any);

    const result = await getPersonalLibrary("user-1");
    expect(result[0].progress).toBe(0);
  });

  it("sets hasProgress only for books at or past 1%", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([
      makeAccess({ id: "book-none" }),
      makeAccess({ id: "book-0" }),
      makeAccess({ id: "book-1" }),
      makeAccess({ id: "book-5" }),
    ] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      { bookId: "book-0", percentage: 0 },
      { bookId: "book-1", percentage: 1 },
      { bookId: "book-5", percentage: 5 },
    ] as any);

    const result = await getPersonalLibrary("user-1");
    const byId = Object.fromEntries(result.map((b) => [b.id, b]));
    expect(byId["book-none"].hasProgress).toBe(false); // never opened
    expect(byId["book-0"].hasProgress).toBe(false); // 0%
    expect(byId["book-1"].hasProgress).toBe(true); // 1% — threshold
    expect(byId["book-5"].hasProgress).toBe(true); // 5%
  });

  it("maps multiple books with mixed progress states", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([
      makeAccess({ id: "book-1" }),
      makeAccess({ id: "book-2" }),
      makeAccess({ id: "book-3" }),
    ] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      { bookId: "book-1", percentage: 50 },
      { bookId: "book-2", percentage: 75 },
    ] as any);

    const result = await getPersonalLibrary("user-1");
    const byId = Object.fromEntries(result.map((b) => [b.id, b]));
    expect(byId["book-1"].progress).toBe(50);
    expect(byId["book-2"].progress).toBe(75);
    expect(byId["book-3"].progress).toBeNull();
  });

  it("sorts books by most recently opened, then most recently added", async () => {
    const old = new Date("2024-01-01T00:00:00Z");
    const mid = new Date("2024-05-01T00:00:00Z");
    const recent = new Date("2024-06-01T00:00:00Z");

    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([
      makeAccess({ id: "book-old", totalParagraphs: 100 }, { createdAt: old }),
      makeAccess({ id: "book-read", totalParagraphs: 100 }, { createdAt: old }),
      makeAccess({ id: "book-new", totalParagraphs: 100 }, { createdAt: mid }),
    ] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      // book-read was opened recently even though it was added long ago
      { bookId: "book-read", paragraphIndex: 10, updatedAt: recent },
    ] as any);

    const result = await getPersonalLibrary("user-1");
    expect(result.map((b) => b.id)).toEqual([
      "book-read", // recently opened (updatedAt = recent)
      "book-new", // recently added (createdAt = mid), never opened
      "book-old", // added long ago, never opened
    ]);
  });
});
