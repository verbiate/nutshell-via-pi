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
  deleteBookmark: vi.fn(),
}));

import { DELETE } from "@/app/api/reader/bookmarks/[id]/route";
import { requireAuth } from "@/lib/auth-guards";
import { deleteBookmark } from "@/server/services/reader";

describe("DELETE /api/reader/bookmarks/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new (class extends Error { statusCode = 401 })());
    const req = new Request("http://localhost/api/reader/bookmarks/b1");
    const res = await DELETE(req, { params: Promise.resolve({ id: "b1" }) });
    expect(res.status).toBe(401);
  });

  it("deletes owned bookmark", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(deleteBookmark).mockResolvedValue(undefined);
    const req = new Request("http://localhost/api/reader/bookmarks/b1");
    const res = await DELETE(req, { params: Promise.resolve({ id: "b1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 404 for non-existent bookmark", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(deleteBookmark).mockRejectedValue(new Error("Bookmark not found or access denied"));
    const req = new Request("http://localhost/api/reader/bookmarks/b1");
    const res = await DELETE(req, { params: Promise.resolve({ id: "b1" }) });
    expect(res.status).toBe(404);
  });
});
