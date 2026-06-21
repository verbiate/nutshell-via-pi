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
  getHighlights: vi.fn(),
  createHighlight: vi.fn(),
  verifyBookAccess: vi.fn(),
}));

import { GET, POST } from "@/app/api/reader/highlights/route";
import { requireAuth } from "@/lib/auth-guards";
import { getHighlights, createHighlight, verifyBookAccess } from "@/server/services/reader";

describe("GET /api/reader/highlights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when bookId is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    const req = new Request("http://localhost/api/reader/highlights");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("bookId is required");
  });

  it("returns 403 when user lacks access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);
    const req = new Request("http://localhost/api/reader/highlights?bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

    it("returns highlights on success", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(getHighlights).mockResolvedValue([
      { id: "h1", cfi: "epubcfi(/6/2)", paragraphIndex: 1, charOffsetStart: 0, charOffsetEnd: 5, selectedText: "hello", color: "#FEC405" },
    ] as any);
    const req = new Request("http://localhost/api/reader/highlights?bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.highlights).toHaveLength(1);
    expect(body.highlights[0].color).toBe("#FEC405");
  });
});

describe("POST /api/reader/highlights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when required fields are missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    const req = new Request("http://localhost/api/reader/highlights", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1", cfi: "epubcfi(/6/2)" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when color is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    const req = new Request("http://localhost/api/reader/highlights", {
      method: "POST",
      body: JSON.stringify({
        bookId: "b1",
        cfi: "epubcfi(/6/2)",
        paragraphIndex: 1,
        charOffsetStart: 0,
        charOffsetEnd: 5,
        selectedText: "hello",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("color is required");
    expect(createHighlight).not.toHaveBeenCalled();
  });

  it("returns 400 when color is not one of the allowed swatches", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    const req = new Request("http://localhost/api/reader/highlights", {
      method: "POST",
      body: JSON.stringify({
        bookId: "b1",
        cfi: "epubcfi(/6/2)",
        paragraphIndex: 1,
        charOffsetStart: 0,
        charOffsetEnd: 5,
        selectedText: "hello",
        color: "#00ff00",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("allowed highlight colors");
    expect(createHighlight).not.toHaveBeenCalled();
  });

  it("creates highlight when valid", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(createHighlight).mockResolvedValue({ id: "h1" } as any);
    const req = new Request("http://localhost/api/reader/highlights", {
      method: "POST",
      body: JSON.stringify({
        bookId: "b1",
        cfi: "epubcfi(/6/2)",
        paragraphIndex: 1,
        charOffsetStart: 0,
        charOffsetEnd: 5,
        selectedText: "hello",
        color: "#FEC405",
        pageNumber: 42,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.highlight.id).toBe("h1");
    expect(createHighlight).toHaveBeenCalledWith(
      "u1",
      "b1",
      expect.objectContaining({ selectedText: "hello", color: "#FEC405", pageNumber: 42 })
    );
  });
});
