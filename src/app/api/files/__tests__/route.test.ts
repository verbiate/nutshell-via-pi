import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-guards", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    epubFile: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/server/services/reader", () => ({
  verifyBookAccess: vi.fn(),
}));

vi.mock("@/server/storage/local", () => ({
  storage: {
    read: vi.fn(),
  },
}));

import { GET } from "@/app/api/files/[[...path]]/route";
import { requireAuth } from "@/lib/auth-guards";
import { db } from "@/server/db";
import { verifyBookAccess } from "@/server/services/reader";
import { storage } from "@/server/storage/local";

function makeRequest(path: string) {
  return new Request(`http://localhost/api/files${path}`);
}

describe("GET /api/files/[[...path]]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue({ statusCode: 401 } as any);

    const res = await GET(makeRequest("/epubs/abc.epub") as any, {
      params: Promise.resolve({ path: ["epubs", "abc.epub"] }),
    } as any);

    expect(res.status).toBe(401);
  });

  it("rejects path traversal attempts", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "user1" } as any);

    const res = await GET(makeRequest("/../etc/passwd") as any, {
      params: Promise.resolve({ path: ["..", "etc", "passwd"] }),
    } as any);

    expect(res.status).toBe(400);
    expect(storage.read).not.toHaveBeenCalled();
  });

  it("returns 403 for a book the user cannot access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "user1" } as any);
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({ id: "book1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);

    const res = await GET(makeRequest("/epubs/abc.epub") as any, {
      params: Promise.resolve({ path: ["epubs", "abc.epub"] }),
    } as any);

    expect(res.status).toBe(403);
    expect(storage.read).not.toHaveBeenCalled();
  });

  it("serves the file when the user has book access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "user1" } as any);
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({ id: "book1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(storage.read).mockResolvedValue(Buffer.from("epub content"));

    const res = await GET(makeRequest("/epubs/abc.epub") as any, {
      params: Promise.resolve({ path: ["epubs", "abc.epub"] }),
    } as any);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(storage.read).toHaveBeenCalledWith("epubs/abc.epub");
  });

  it("allows authenticated access to tts audio without per-book check", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "user1" } as any);
    vi.mocked(storage.read).mockResolvedValue(Buffer.from("mp3 bytes"));

    const res = await GET(makeRequest("/tts/abc/audio.mp3") as any, {
      params: Promise.resolve({ path: ["tts", "abc", "audio.mp3"] }),
    } as any);

    expect(res.status).toBe(200);
    expect(db.epubFile.findUnique).not.toHaveBeenCalled();
    expect(storage.read).toHaveBeenCalledWith("tts/abc/audio.mp3");
  });
});
