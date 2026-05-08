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
  },
}));

vi.mock("@/server/storage/local", () => ({
  storage: {
    read: vi.fn(),
  },
}));

import { GET } from "@/app/api/reader/txt/route";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { db } from "@/server/db";
import { storage } from "@/server/storage/local";

describe("GET /api/reader/txt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when bookId is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    const req = new Request("http://localhost/api/reader/txt");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when user lacks access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);
    const req = new Request("http://localhost/api/reader/txt?bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 404 when book has no TXT", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({ txtPath: null } as any);
    const req = new Request("http://localhost/api/reader/txt?bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("returns TXT content on success", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({ txtPath: "txts/b1.txt" } as any);
    vi.spyOn(storage, "read").mockResolvedValue(Buffer.from("hello world\nsecond line"));
    const req = new Request("http://localhost/api/reader/txt?bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("hello world\nsecond line");
  });
});
