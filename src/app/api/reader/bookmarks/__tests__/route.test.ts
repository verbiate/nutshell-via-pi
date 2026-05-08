import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-guards", () => ({
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(m: string, s: number) {
      super(m);
      this.statusCode = s;
    }
  },
}));

vi.mock("@/server/services/reader", () => ({
  getBookmarks: vi.fn(),
  createBookmark: vi.fn(),
  verifyBookAccess: vi.fn(),
}));

import { GET, POST } from "@/app/api/reader/bookmarks/route";
import { requireAuth } from "@/lib/auth-guards";
import { getBookmarks, createBookmark, verifyBookAccess } from "@/server/services/reader";

describe("GET /api/reader/bookmarks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when bookId is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    const req = new Request("http://localhost/api/reader/bookmarks");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("bookId is required");
  });

  it("returns 403 when user lacks access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);
    const req = new Request("http://localhost/api/reader/bookmarks?bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns bookmarks on success", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(getBookmarks).mockResolvedValue([
      { id: "b1", cfi: "epubcfi(/6/2)", paragraphIndex: 1, charOffset: 0, selectedText: "hello" },
    ] as any);
    const req = new Request("http://localhost/api/reader/bookmarks?bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bookmarks).toHaveLength(1);
  });
});

describe("POST /api/reader/bookmarks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when required fields are missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    const req = new Request("http://localhost/api/reader/bookmarks", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates bookmark when valid", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(createBookmark).mockResolvedValue({ id: "b1" } as any);
    const req = new Request("http://localhost/api/reader/bookmarks", {
      method: "POST",
      body: JSON.stringify({
        bookId: "b1",
        cfi: "epubcfi(/6/2)",
        paragraphIndex: 1,
        charOffset: 0,
        selectedText: "hello",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bookmark.id).toBe("b1");
  });
});
