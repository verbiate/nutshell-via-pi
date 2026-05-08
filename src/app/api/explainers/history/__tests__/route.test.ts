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
  verifyBookAccess: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    epubFile: { findUnique: vi.fn() },
    explainerRequest: { findMany: vi.fn() },
  },
}));

import { GET } from "@/app/api/explainers/history/route";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { db } from "@/server/db";

describe("GET /api/explainers/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when bookId is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    const req = new Request("http://localhost/api/explainers/history");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when user lacks access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);
    const req = new Request("http://localhost/api/explainers/history?bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns explainers scoped by userId and bookId via ExplainerRequest", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({ id: "b1", title: "Test Book", tocJson: null } as any);
    vi.mocked(db.explainerRequest.findMany).mockResolvedValue([
      {
        id: "r1",
        userId: "u1",
        bookId: "b1",
        passageCfi: null,
        passageText: null,
        sectionHref: null,
        createdAt: new Date(),
        explainer: { id: "e1", contentType: "book", tier: "regular", language: "en", content: "Book explainer" },
      },
      {
        id: "r2",
        userId: "u1",
        bookId: "b1",
        passageCfi: "epubcfi(/6/2)",
        passageText: "A selected passage",
        sectionHref: null,
        createdAt: new Date(),
        explainer: { id: "e2", contentType: "passage", tier: "pro", language: "vi", content: "Passage explainer" },
      },
    ] as any);
    const req = new Request("http://localhost/api/explainers/history?bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.explainers).toHaveLength(2);
    expect(body.explainers[0].targetLabel).toBe("Test Book");
    expect(body.explainers[1].targetLabel).toContain("A selected passage");
    expect(db.explainerRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", bookId: "b1" },
        orderBy: { createdAt: "desc" },
        include: { explainer: true },
      })
    );
  });
});
