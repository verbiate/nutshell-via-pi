import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-guards", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    user: {
      update: vi.fn(),
    },
  },
}));

import { PATCH } from "@/app/api/user/language/route";
import { requireAuth } from "@/lib/auth-guards";
import { db } from "@/server/db";

describe("PATCH /api/user/language", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid language", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);

    const req = new Request("http://localhost/api/user/language", {
      method: "PATCH",
      body: JSON.stringify({ language: "english" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("updates user preferred language", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u1",
      preferredLanguage: "vi",
    } as any);

    const req = new Request("http://localhost/api/user/language", {
      method: "PATCH",
      body: JSON.stringify({ language: "vi" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.preferredLanguage).toBe("vi");
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: { preferredLanguage: "vi" },
      })
    );
  });
});
