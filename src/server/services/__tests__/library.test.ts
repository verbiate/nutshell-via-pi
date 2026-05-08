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

  function makeAccess(bookOverrides: Record<string, unknown> = {}) {
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
    };
  }

  it("computes 50% progress when halfway through", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([makeAccess()] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      { bookId: "book-1", paragraphIndex: 50 },
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

  it("returns null progress when totalParagraphs is missing", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([
      makeAccess({ totalParagraphs: null }),
    ] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      { bookId: "book-1", paragraphIndex: 50 },
    ] as any);

    const result = await getPersonalLibrary("user-1");
    expect(result[0].progress).toBeNull();
  });

  it("caps progress at 100%", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([makeAccess()] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      { bookId: "book-1", paragraphIndex: 999 },
    ] as any);

    const result = await getPersonalLibrary("user-1");
    expect(result[0].progress).toBe(100);
  });

  it("returns 0 progress when at start", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([makeAccess()] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      { bookId: "book-1", paragraphIndex: 0 },
    ] as any);

    const result = await getPersonalLibrary("user-1");
    expect(result[0].progress).toBe(0);
  });

  it("maps multiple books with mixed progress states", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([
      makeAccess({ id: "book-1", totalParagraphs: 100 }),
      makeAccess({ id: "book-2", totalParagraphs: 200 }),
      makeAccess({ id: "book-3", totalParagraphs: null }),
    ] as any);
    vi.mocked(db.userBookPosition.findMany).mockResolvedValue([
      { bookId: "book-1", paragraphIndex: 50 },
      { bookId: "book-2", paragraphIndex: 100 },
    ] as any);

    const result = await getPersonalLibrary("user-1");
    expect(result[0].progress).toBe(50);
    expect(result[1].progress).toBe(50);
    expect(result[2].progress).toBeNull();
  });
});
