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
  generateExplainer: vi.fn(),
  computeContentHash: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    promptTemplate: { findUnique: vi.fn() },
    explainer: { findUnique: vi.fn(), create: vi.fn() },
    explainerRequest: { create: vi.fn() },
  },
}));

import { POST } from "@/app/api/explainers/generate/route";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";

describe("POST /api/explainers/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for passage type without passageText", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      preferredLanguage: "en",
      role: "regular",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    const req = new Request("http://localhost/api/explainers/generate", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1", type: "passage" }),
    });
    const res = await POST(req);
    // The route returns a text/event-stream Response with status 400
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("passageText is required");
  });

  it("returns 403 when user lacks access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      preferredLanguage: "en",
      role: "regular",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);
    const req = new Request("http://localhost/api/explainers/generate", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1", type: "book" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
