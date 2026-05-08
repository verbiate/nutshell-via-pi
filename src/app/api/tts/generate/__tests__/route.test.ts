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

vi.mock("@/server/services/tts", () => ({
  generateTtsAudio: vi.fn(),
}));

import { POST } from "@/app/api/tts/generate/route";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { generateTtsAudio } from "@/server/services/tts";

describe("POST /api/tts/generate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when bookId is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      role: "regular",
    } as any);

    const req = new Request("http://localhost/api/tts/generate", {
      method: "POST",
      body: JSON.stringify({ sectionHref: "/ch1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("bookId and sectionHref are required");
  });

  it("returns 400 when sectionHref is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      role: "regular",
    } as any);

    const req = new Request("http://localhost/api/tts/generate", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("bookId and sectionHref are required");
  });

  it("returns 403 when user has no book access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      role: "regular",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);

    const req = new Request("http://localhost/api/tts/generate", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1", sectionHref: "/ch1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns cached audio on cache hit", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      role: "regular",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(generateTtsAudio).mockResolvedValue({
      cached: true,
      audioId: "a1",
      url: "/api/files/tts/hash123/voice_model.mp3",
    });

    const req = new Request("http://localhost/api/tts/generate", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1", sectionHref: "/ch1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.audioId).toBe("a1");
    expect(generateTtsAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: "b1",
        sectionHref: "/ch1",
        tier: "regular",
      })
    );
  });

  it("returns newly generated audio on cache miss", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      role: "pro",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(generateTtsAudio).mockResolvedValue({
      cached: false,
      audioId: "a2",
      url: "/api/files/tts/newhash/voice_model.mp3",
    });

    const req = new Request("http://localhost/api/tts/generate", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1", sectionHref: "/ch1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.audioId).toBe("a2");
    // Pro user maps to "pro" tier
    expect(generateTtsAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: "b1",
        sectionHref: "/ch1",
        tier: "pro",
      })
    );
  });

  it("returns 503 when TTS provider not configured", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "u1",
      role: "regular",
    } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(generateTtsAudio).mockRejectedValue(
      Object.assign(
        new Error("TTS provider not configured for tier: regular"),
        { statusCode: 503 }
      )
    );

    const req = new Request("http://localhost/api/tts/generate", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1", sectionHref: "/ch1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Audio generation is not yet configured");
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue({
      statusCode: 401,
    } as any);

    const req = new Request("http://localhost/api/tts/generate", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1", sectionHref: "/ch1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
