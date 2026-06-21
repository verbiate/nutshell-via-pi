import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-guards", () => ({
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(m: string, s: number) {
      super(m);
      this.statusCode = s;
    }
  },
}));

vi.mock("@/server/services/openrouter", () => ({
  getOpenRouterConfig: vi.fn(),
  streamChat: vi.fn(),
  OpenRouterError: class OpenRouterError extends Error {
    statusCode: number;
    constructor(m: string, s: number) {
      super(m);
      this.statusCode = s;
    }
  },
}));

import { POST } from "@/app/api/admin/playground/chat/route";
import { requireAdmin } from "@/lib/auth-guards";
import { getOpenRouterConfig } from "@/server/services/openrouter";

describe("POST /api/admin/playground/chat", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 SSE error when unauthenticated", async () => {
    vi.mocked(requireAdmin).mockRejectedValue({
      statusCode: 401,
    } as any);

    const req = new Request("http://localhost/api/admin/playground/chat", {
      method: "POST",
      body: JSON.stringify({ tier: "admin", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toContain("\"error\"");
  });

  it("returns 403 SSE error when non-admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValue({
      statusCode: 403,
    } as any);

    const req = new Request("http://localhost/api/admin/playground/chat", {
      method: "POST",
      body: JSON.stringify({ tier: "admin", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when tier is missing or invalid", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin1" } as any);

    const req = new Request("http://localhost/api/admin/playground/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("tier must be");
  });

  it("returns 400 when messages is missing or empty", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin1" } as any);

    const req = new Request("http://localhost/api/admin/playground/chat", {
      method: "POST",
      body: JSON.stringify({ tier: "admin", messages: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("messages must be");
  });

  it("returns 500 SSE error when admin tier has no API key", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin1" } as any);
    vi.mocked(getOpenRouterConfig).mockResolvedValue({
      apiKey: "",
      model: "some-model",
    });

    const req = new Request("http://localhost/api/admin/playground/chat", {
      method: "POST",
      body: JSON.stringify({
        tier: "admin",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("No API key configured for admin tier");
  });
});
