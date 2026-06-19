import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    bookmark: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    highlight: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    userBookAccess: {
      findUnique: vi.fn(),
    },
    epubFile: {
      findUnique: vi.fn(),
    },
  },
}));

import { db } from "@/server/db";
import {
  getBookmarks,
  createBookmark,
  deleteBookmark,
  getHighlights,
  createHighlight,
  deleteHighlight,
  verifyBookAccess,
} from "@/server/services/reader";

describe("READ-06: Bookmark service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getBookmarks returns ordered bookmarks", async () => {
    vi.mocked(db.bookmark.findMany).mockResolvedValue([
      { id: "b1", cfi: "epubcfi(/6/2!/4/2)", paragraphIndex: 5, charOffset: 10, selectedText: "hello" },
    ] as any);
    const result = await getBookmarks("u1", "book1");
    expect(result).toHaveLength(1);
    expect(result[0].cfi).toBe("epubcfi(/6/2!/4/2)");
    expect(db.bookmark.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", bookId: "book1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("createBookmark inserts with correct fields", async () => {
    vi.mocked(db.bookmark.create).mockResolvedValue({ id: "b1" } as any);
    await createBookmark("u1", "book1", {
      cfi: "epubcfi(/6/2!/4/2)",
      paragraphIndex: 5,
      charOffset: 10,
      selectedText: "hello",
    });
    expect(db.bookmark.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        bookId: "book1",
        cfi: "epubcfi(/6/2!/4/2)",
        paragraphIndex: 5,
        charOffset: 10,
        selectedText: "hello",
      }),
    });
  });

  it("deleteBookmark removes owned bookmark", async () => {
    vi.mocked(db.bookmark.findUnique).mockResolvedValue({ userId: "u1" } as any);
    vi.mocked(db.bookmark.delete).mockResolvedValue({} as any);
    await deleteBookmark("u1", "b1");
    expect(db.bookmark.delete).toHaveBeenCalledWith({ where: { id: "b1" } });
  });

  it("deleteBookmark throws for non-owner", async () => {
    vi.mocked(db.bookmark.findUnique).mockResolvedValue({ userId: "u2" } as any);
    await expect(deleteBookmark("u1", "b1")).rejects.toThrow("Bookmark not found or access denied");
  });
});

describe("READ-07: Highlight service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getHighlights returns ordered highlights", async () => {
    vi.mocked(db.highlight.findMany).mockResolvedValue([
      { id: "h1", cfi: "epubcfi(/6/2!/4/2)", color: "#FEC405", selectedText: "hello world" },
    ] as any);
    const result = await getHighlights("u1", "book1");
    expect(result).toHaveLength(1);
    expect(result[0].color).toBe("#FEC405");
    expect(db.highlight.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", bookId: "book1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("createHighlight inserts with the caller-provided color", async () => {
    vi.mocked(db.highlight.create).mockResolvedValue({ id: "h1" } as any);
    await createHighlight("u1", "book1", {
      cfi: "epubcfi(/6/2!/4/2)",
      paragraphIndex: 5,
      charOffsetStart: 10,
      charOffsetEnd: 21,
      selectedText: "hello world",
      color: "#FEC405",
    });
    expect(db.highlight.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        bookId: "book1",
        cfi: "epubcfi(/6/2!/4/2)",
        paragraphIndex: 5,
        charOffsetStart: 10,
        charOffsetEnd: 21,
        selectedText: "hello world",
        color: "#FEC405",
      }),
    });
  });

  it("deleteHighlight removes owned highlight", async () => {
    vi.mocked(db.highlight.findUnique).mockResolvedValue({ userId: "u1" } as any);
    vi.mocked(db.highlight.delete).mockResolvedValue({} as any);
    await deleteHighlight("u1", "h1");
    expect(db.highlight.delete).toHaveBeenCalledWith({ where: { id: "h1" } });
  });

  it("deleteHighlight throws for non-owner", async () => {
    vi.mocked(db.highlight.findUnique).mockResolvedValue({ userId: "u2" } as any);
    await expect(deleteHighlight("u1", "h1")).rejects.toThrow("Highlight not found or access denied");
  });
});

describe("verifyBookAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true for explicit access", async () => {
    vi.mocked(db.userBookAccess.findUnique).mockResolvedValue({ id: "a1" } as any);
    const result = await verifyBookAccess("u1", "book1");
    expect(result).toBe(true);
  });

  it("returns true for uploader", async () => {
    vi.mocked(db.userBookAccess.findUnique).mockResolvedValue(null);
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({ uploadedById: "u1" } as any);
    const result = await verifyBookAccess("u1", "book1");
    expect(result).toBe(true);
  });

  it("returns false for no access", async () => {
    vi.mocked(db.userBookAccess.findUnique).mockResolvedValue(null);
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({ uploadedById: "u2" } as any);
    const result = await verifyBookAccess("u1", "book1");
    expect(result).toBe(false);
  });
});
