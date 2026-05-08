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

vi.mock("@/server/db", () => ({
  db: {
    ttsAudio: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/server/storage/local", () => ({
  storage: {
    read: vi.fn(),
  },
}));

import { GET } from "@/app/api/tts/audio/route";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { db } from "@/server/db";
import { storage } from "@/server/storage/local";

describe("GET /api/tts/audio", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when id is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);

    const req = new Request("http://localhost/api/tts/audio?bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("id and bookId are required");
  });

  it("returns 400 when bookId is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);

    const req = new Request("http://localhost/api/tts/audio?id=a1");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("id and bookId are required");
  });

  it("returns 403 when user has no book access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);

    const req = new Request(
      "http://localhost/api/tts/audio?id=a1&bookId=b1"
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 404 when audio not found", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.ttsAudio.findUnique).mockResolvedValue(null);

    const req = new Request(
      "http://localhost/api/tts/audio?id=nonexistent&bookId=b1"
    );
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("returns 200 with audio/mpeg for ElevenLabs provider", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.ttsAudio.findUnique).mockResolvedValue({
      id: "a1",
      storagePath: "tts/hash/voice_model.mp3",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
    } as any);
    vi.mocked(storage.read).mockResolvedValue(Buffer.from("fake mp3 data"));

    const req = new Request("http://localhost/api/tts/audio?id=a1&bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it("returns 200 with audio/wav for fal provider with wav model", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.ttsAudio.findUnique).mockResolvedValue({
      id: "a2",
      storagePath: "tts/hash2/voice.wav",
      provider: "fal",
      model: "voice_model.wav",
    } as any);
    vi.mocked(storage.read).mockResolvedValue(Buffer.from("fake wav data"));

    const req = new Request("http://localhost/api/tts/audio?id=a2&bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/wav");
  });

  it("returns audio/mpeg for fal provider with non-wav model", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(db.ttsAudio.findUnique).mockResolvedValue({
      id: "a3",
      storagePath: "tts/hash3/voice.mp3",
      provider: "fal",
      model: "fal-voice-model",
    } as any);
    vi.mocked(storage.read).mockResolvedValue(Buffer.from("fake mp3 data"));

    const req = new Request("http://localhost/api/tts/audio?id=a3&bookId=b1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
  });
});
