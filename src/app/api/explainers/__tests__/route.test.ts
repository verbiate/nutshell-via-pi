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

vi.mock("@/server/services/explainer", () => ({
  getExplainer: vi.fn(),
  computeContentHash: vi.fn(() => "hash123"),
}));

vi.mock("@/server/db", () => ({
  db: {
    epubFile: { findUnique: vi.fn() },
    promptTemplate: { findUnique: vi.fn() },
  },
}));

vi.mock("@/server/services/section-extractor", () => ({
  extractSectionText: vi.fn(),
}));

import { GET } from "@/app/api/explainers/route";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { getExplainer } from "@/server/services/explainer";
import { db } from "@/server/db";
import { storage } from "@/server/storage/local";

describe("GET /api/explainers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when bookId is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      preferredLanguage: "en",
      role: "regular",
    } as any);

    const req = new Request("http://localhost/api/explainers?type=book");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("bookId and type are required");
  });

  it("returns cached explainer on cache hit", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      preferredLanguage: "en",
      role: "regular",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({
      id: "b1",
      txtPath: "txts/b1.txt",
      tocJson: null,
      epubPath: "epubs/b1.epub",
    } as any);
    vi.mocked(db.promptTemplate.findUnique).mockResolvedValue({
      version: 1,
    } as any);
    vi.spyOn(storage, "read").mockResolvedValue(Buffer.from("book text content"));
    vi.mocked(getExplainer).mockResolvedValue({
      content: "cached explanation",
      modelId: "google/gemini-2.0-flash-001",
      createdAt: new Date("2026-01-01"),
    } as any);

    const req = new Request("http://localhost/api/explainers?bookId=b1&type=book&lang=en");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.content).toBe("cached explanation");
  });

  it("returns 404 when no cached explainer exists", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      preferredLanguage: "en",
      role: "regular",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({
      id: "b1",
      txtPath: "txts/b1.txt",
      tocJson: null,
      epubPath: "epubs/b1.epub",
    } as any);
    vi.mocked(db.promptTemplate.findUnique).mockResolvedValue({
      version: 1,
    } as any);
    vi.spyOn(storage, "read").mockResolvedValue(Buffer.from("book text content"));
    vi.mocked(getExplainer).mockResolvedValue(null);

    const req = new Request("http://localhost/api/explainers?bookId=b1&type=book&lang=en");
    const res = await GET(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.cached).toBe(false);
  });

  it("returns 400 for passage type without passageText", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      preferredLanguage: "en",
      role: "regular",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);

    const req = new Request("http://localhost/api/explainers?bookId=b1&type=passage&lang=en");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("passageText is required");
  });
});
