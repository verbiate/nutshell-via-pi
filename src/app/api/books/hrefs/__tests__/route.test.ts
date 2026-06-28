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
    epubFile: { findMany: vi.fn() },
  },
}));

import { POST } from "@/app/api/books/hrefs/route";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { db } from "@/server/db";

function makeReq(body: unknown) {
  return new Request("http://localhost/api/books/hrefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const toc = (hrefs: string[]) => JSON.stringify(hrefs.map((href) => ({ href })));

describe("POST /api/books/hrefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      preferredLanguage: "en",
      role: "regular",
    } as any);
  });

  it("returns {} for empty bookIds", async () => {
    const res = await POST(makeReq({ bookIds: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(verifyBookAccess).not.toHaveBeenCalled();
  });

  it("returns {} for missing/non-array bookIds", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("skips inaccessible books (no structure leak)", async () => {
    vi.mocked(verifyBookAccess)
      .mockResolvedValueOnce(false) // b1 denied
      .mockResolvedValueOnce(true); // b2 allowed
    vi.mocked(db.epubFile.findMany).mockResolvedValue([
      { id: "b2", tocJson: toc(["ch1.xhtml", "OEBPS/ch2.xhtml"]) },
    ] as any);

    const res = await POST(makeReq({ bookIds: ["b1", "b2"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ b2: ["ch1.xhtml", "ch2.xhtml"] });
    // Only accessible ids are queried.
    expect(db.epubFile.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["b2"] } },
      select: { id: true, tocJson: true },
    });
  });

  it("returns {} when no book is accessible", async () => {
    vi.mocked(verifyBookAccess).mockResolvedValue(false);
    const res = await POST(makeReq({ bookIds: ["b1"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(db.epubFile.findMany).not.toHaveBeenCalled();
  });

  it("dedupes and skips unparseable tocJson", async () => {
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.epubFile.findMany).mockResolvedValue([
      { id: "b1", tocJson: "{not json" },
      { id: "b2", tocJson: toc(["a.xhtml"]) },
    ] as any);

    const res = await POST(makeReq({ bookIds: ["b1", "b1", "b2"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ b2: ["a.xhtml"] });
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(
      Object.assign(new Error("Authentication required"), { statusCode: 401 })
    );
    const res = await POST(makeReq({ bookIds: ["b1"] }));
    expect(res.status).toBe(401);
  });
});
