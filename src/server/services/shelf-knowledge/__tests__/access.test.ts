import { describe, it, expect, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    userBookAccess: { findMany: vi.fn() },
    epubFile: { findMany: vi.fn() },
  },
}));

import { getAccessibleBookIds } from "../access";
import { db } from "@/server/db";

describe("getAccessibleBookIds", () => {
  it("unions UserBookAccess bookIds and the user's uploaded books", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([
      { bookId: "b1" },
      { bookId: "b2" },
    ] as any);
    vi.mocked(db.epubFile.findMany).mockResolvedValue([
      { id: "b3" },
    ] as any);

    const ids = await getAccessibleBookIds("u1");
    expect(ids.sort()).toEqual(["b1", "b2", "b3"]);

    expect(db.userBookAccess.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: { bookId: true },
    });
    expect(db.epubFile.findMany).toHaveBeenCalledWith({
      where: { uploadedById: "u1" },
      select: { id: true },
    });
  });

  it("dedupes when a book appears in both sets", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([
      { bookId: "b1" },
    ] as any);
    vi.mocked(db.epubFile.findMany).mockResolvedValue([
      { id: "b1" },
    ] as any);
    const ids = await getAccessibleBookIds("u1");
    expect(ids).toEqual(["b1"]);
  });

  it("returns [] for a user with no books", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([]);
    vi.mocked(db.epubFile.findMany).mockResolvedValue([]);
    const ids = await getAccessibleBookIds("u1");
    expect(ids).toEqual([]);
  });
});
