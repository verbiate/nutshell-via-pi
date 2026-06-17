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

vi.mock("@/server/db", () => ({
  db: {
    openRouterConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    ttsProviderConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import { GET, PATCH } from "@/app/api/admin/config/route";
import { requireAdmin } from "@/lib/auth-guards";
import { db } from "@/server/db";

describe("GET /api/admin/config", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAdmin).mockRejectedValue({ statusCode: 401 } as any);

    const req = new Request(
      "http://localhost/api/admin/config?category=openrouter"
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid category", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin1" } as any);

    const req = new Request(
      "http://localhost/api/admin/config?category=invalid"
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("category must be");
  });

  it("returns openrouter configs for openrouter category", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin1" } as any);
    vi.mocked(db.openRouterConfig.findMany).mockResolvedValue([
      { id: "c1", userType: "regular", apiKey: null, model: "gemini-flash" },
      { id: "c2", userType: "pro", apiKey: "sk-real", model: "claude-sonnet" },
    ] as any);

    const req = new Request(
      "http://localhost/api/admin/config?category=openrouter"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configs).toHaveLength(2);
    expect(body.configs[0].userType).toBe("regular");
    // API keys must be masked on GET, not returned raw.
    expect(body.configs[0].apiKey).toBeNull();
    expect(body.configs[1].apiKey).toBe("***");
  });

  it("returns ttsProviderConfig rows for elevenlabs category", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin1" } as any);
    vi.mocked(db.ttsProviderConfig.findMany).mockResolvedValue([
      {
        id: "t1",
        provider: "elevenlabs",
        userType: "regular",
        apiKey: null,
        model: null,
        voiceId: null,
      },
    ] as any);

    const req = new Request(
      "http://localhost/api/admin/config?category=elevenlabs"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configs).toHaveLength(1);
    expect(body.configs[0].provider).toBe("elevenlabs");
  });
});

describe("PATCH /api/admin/config", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when category is missing", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin1" } as any);

    const req = new Request("http://localhost/api/admin/config", {
      method: "PATCH",
      body: JSON.stringify({ userType: "regular" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("category and userType are required");
  });

  it("upserts openrouter config and creates audit log with masked key", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin1" } as any);
    vi.mocked(db.openRouterConfig.findUnique).mockResolvedValue(null);
    vi.mocked(db.openRouterConfig.upsert).mockResolvedValue({} as any);
    vi.mocked(db.auditLog.create).mockResolvedValue({} as any);

    const req = new Request("http://localhost/api/admin/config", {
      method: "PATCH",
      body: JSON.stringify({
        category: "openrouter",
        userType: "regular",
        apiKey: "sk-proj-abcdefgh1234567",
        model: "google/gemini-2.0-flash-001",
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(db.openRouterConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userType: "regular" },
        create: expect.objectContaining({
          userType: "regular",
          apiKey: "sk-proj-abcdefgh1234567",
          model: "google/gemini-2.0-flash-001",
        }),
      })
    );
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: "admin1",
        action: "UPDATE_OPENROUTER_CONFIG",
        entityType: "OpenRouterConfig",
        entityId: "regular",
      }),
    });
    // Verify masked key in audit log newValue
    const auditCall = vi.mocked(db.auditLog.create).mock.calls[0][0];
    const newValue = JSON.parse(auditCall.data.newValue!);
    expect(newValue.apiKey).toBe("sk-p...4567");
  });

  it("upserts ttsProviderConfig and creates audit log for elevenlabs", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin1" } as any);
    vi.mocked(db.ttsProviderConfig.findUnique).mockResolvedValue(null);
    vi.mocked(db.ttsProviderConfig.upsert).mockResolvedValue({} as any);
    vi.mocked(db.auditLog.create).mockResolvedValue({} as any);

    const req = new Request("http://localhost/api/admin/config", {
      method: "PATCH",
      body: JSON.stringify({
        category: "elevenlabs",
        userType: "pro",
        apiKey: "sk-el-abcdefgh1234",
        model: "eleven_multilingual_v2",
        voiceId: "rachel_voice",
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(db.ttsProviderConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_userType: { provider: "elevenlabs", userType: "pro" },
        },
        create: expect.objectContaining({
          provider: "elevenlabs",
          userType: "pro",
          voiceId: "rachel_voice",
        }),
      })
    );
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UPDATE_TTS_CONFIG",
        entityType: "TtsProviderConfig",
        entityId: "elevenlabs:pro",
      }),
    });
    const auditCall = vi.mocked(db.auditLog.create).mock.calls[0][0];
    const newValue = JSON.parse(auditCall.data.newValue!);
    expect(newValue.apiKey).toBe("sk-e...1234");
  });

  it("returns 403 when non-admin accesses endpoint", async () => {
    vi.mocked(requireAdmin).mockRejectedValue({ statusCode: 403 } as any);

    const req = new Request("http://localhost/api/admin/config", {
      method: "PATCH",
      body: JSON.stringify({ category: "openrouter", userType: "regular" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(403);
  });
});
