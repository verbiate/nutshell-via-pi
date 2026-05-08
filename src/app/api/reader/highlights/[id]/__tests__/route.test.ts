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
  deleteHighlight: vi.fn(),
}));

import { DELETE } from "@/app/api/reader/highlights/[id]/route";
import { requireAuth } from "@/lib/auth-guards";
import { deleteHighlight } from "@/server/services/reader";

describe("DELETE /api/reader/highlights/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new (class extends Error { statusCode = 401 })());
    const req = new Request("http://localhost/api/reader/highlights/h1");
    const res = await DELETE(req, { params: Promise.resolve({ id: "h1" }) });
    expect(res.status).toBe(401);
  });

  it("deletes owned highlight", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(deleteHighlight).mockResolvedValue(undefined);
    const req = new Request("http://localhost/api/reader/highlights/h1");
    const res = await DELETE(req, { params: Promise.resolve({ id: "h1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 404 for non-existent highlight", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(deleteHighlight).mockRejectedValue(new Error("Highlight not found or access denied"));
    const req = new Request("http://localhost/api/reader/highlights/h1");
    const res = await DELETE(req, { params: Promise.resolve({ id: "h1" }) });
    expect(res.status).toBe(404);
  });
});
