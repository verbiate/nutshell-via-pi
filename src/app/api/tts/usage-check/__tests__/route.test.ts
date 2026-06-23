import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-guards", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/server/services/tts-usage", () => ({
  getCurrentUsage: vi.fn(),
}));

import { POST } from "@/app/api/tts/usage-check/route";
import { requireAuth } from "@/lib/auth-guards";
import { getCurrentUsage } from "@/server/services/tts-usage";

describe("POST /api/tts/usage-check", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns allowed=true when used < limit", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      role: "pro",
    } as any);
    vi.mocked(getCurrentUsage).mockResolvedValue({
      used: 10,
      limit: 50,
      periodKey: "2026-06",
    });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      allowed: true,
      used: 10,
      limit: 50,
      periodKey: "2026-06",
    });
    expect(getCurrentUsage).toHaveBeenCalledWith("u1", "pro");
  });

  it("returns allowed=false when used >= limit", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      role: "pro",
    } as any);
    vi.mocked(getCurrentUsage).mockResolvedValue({
      used: 50,
      limit: 50,
      periodKey: "2026-06",
    });

    const res = await POST();
    expect(res.status).toBe(200);
    expect((await res.json()).allowed).toBe(false);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue({
      statusCode: 401,
    } as any);

    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("returns 500 on unexpected error", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      role: "pro",
    } as any);
    vi.mocked(getCurrentUsage).mockRejectedValue(new Error("db down"));

    const res = await POST();
    expect(res.status).toBe(500);
  });
});
