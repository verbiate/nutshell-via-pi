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
  updateHighlight: vi.fn(),
}));

import { DELETE, PATCH } from "@/app/api/reader/highlights/[id]/route";
import { requireAuth } from "@/lib/auth-guards";
import { deleteHighlight, updateHighlight } from "@/server/services/reader";

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

describe("PATCH /api/reader/highlights/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates note on owned highlight", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(updateHighlight).mockResolvedValue({ id: "h1" } as any);
    const req = new Request("http://localhost/api/reader/highlights/h1", {
      method: "PATCH",
      body: JSON.stringify({ note: "my note" }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "h1" }) });
    expect(res.status).toBe(200);
    expect(updateHighlight).toHaveBeenCalledWith("u1", "h1", {
      note: "my note",
      color: undefined,
    });
  });

  it("returns 400 when neither note nor color provided", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    const req = new Request("http://localhost/api/reader/highlights/h1", {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "h1" }) });
    expect(res.status).toBe(400);
  });
});
