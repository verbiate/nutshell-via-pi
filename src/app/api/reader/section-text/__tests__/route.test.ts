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

vi.mock("@/server/services/section-extractor", () => ({
  extractSectionText: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    epubFile: { findUnique: vi.fn() },
  },
}));

import { POST } from "@/app/api/reader/section-text/route";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { db } from "@/server/db";
import { extractSectionText } from "@/server/services/section-extractor";

function makeReq(body: object) {
  return new Request("http://localhost/api/reader/section-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/reader/section-text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when bookId is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      preferredLanguage: "en",
      role: "regular",
    } as any);

    const res = await POST(makeReq({ sectionHref: "ch1.xhtml" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("bookId and sectionHref are required");
  });

  it("returns 403 when user has no access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      preferredLanguage: "en",
      role: "regular",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);

    const res = await POST(makeReq({ bookId: "b1", sectionHref: "ch1.xhtml" }));
    expect(res.status).toBe(403);
  });

  it("returns 404 when book is not found", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      preferredLanguage: "en",
      role: "regular",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.epubFile.findUnique).mockResolvedValue(null);

    const res = await POST(makeReq({ bookId: "b1", sectionHref: "ch1.xhtml" }));
    expect(res.status).toBe(404);
  });

  it("returns section text on success", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      preferredLanguage: "en",
      role: "regular",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({
      id: "b1",
      epubPath: "epubs/b1.epub",
    } as any);
    vi.mocked(extractSectionText).mockResolvedValue("Hello world");

    const res = await POST(makeReq({ bookId: "b1", sectionHref: "ch1.xhtml" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("Hello world");
    expect(extractSectionText).toHaveBeenCalledWith(
      "epubs/b1.epub",
      "ch1.xhtml",
      { forTts: true },
    );
  });
});
