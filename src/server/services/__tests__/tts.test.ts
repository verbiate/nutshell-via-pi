import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    epubFile: {
      findUnique: vi.fn(),
    },
    ttsAudio: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    ttsProviderConfig: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/server/storage/local", () => ({
  storage: {
    write: vi.fn(),
    getUrl: vi.fn(),
  },
}));

vi.mock("../section-extractor", () => ({
  extractSectionText: vi.fn(),
}));

vi.mock("../tts-providers", () => ({
  callElevenLabs: vi.fn(),
  callFalAi: vi.fn(),
}));

import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { extractSectionText } from "../section-extractor";
import { callElevenLabs, callFalAi } from "../tts-providers";
import {
  computeTtsContentHash,
  chunkText,
  getTtsAudio,
  createTtsAudio,
  getTtsProviderConfig,
  generateTtsAudio,
} from "../tts";

describe("TTS-1A: computeTtsContentHash", () => {
  it("returns 64-char lowercase hex", () => {
    expect(computeTtsContentHash("hello world")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(computeTtsContentHash("foo")).toBe(computeTtsContentHash("foo"));
  });

  it("differs for different inputs", () => {
    expect(computeTtsContentHash("foo")).not.toBe(computeTtsContentHash("bar"));
  });

  it("produces a valid hash for the empty string", () => {
    expect(computeTtsContentHash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});

describe("TTS-1A: chunkText", () => {
  it("throws when maxChars <= 0", () => {
    expect(() => chunkText("text", 0)).toThrow("maxChars must be positive");
    expect(() => chunkText("text", -1)).toThrow("maxChars must be positive");
  });

  it("returns the whole text as a single chunk when under maxChars", () => {
    expect(chunkText("hello", 10)).toEqual(["hello"]);
  });

  it("returns the whole text as a single chunk at exactly maxChars", () => {
    expect(chunkText("hello", 5)).toEqual(["hello"]);
  });

  it("splits at \\n\\n paragraph boundaries", () => {
    expect(chunkText("para1\n\npara2", 5)).toEqual(["para1", "para2"]);
  });

  it("splits at \\n when no \\n\\n is present", () => {
    expect(chunkText("line1\nline2", 5)).toEqual(["line1", "line2"]);
  });

  it("splits a long paragraph at word boundaries, never mid-word", () => {
    const chunks = chunkText("word1 word2 word3 word4 word5", 11);
    expect(chunks).toEqual(["word1 word2", "word3 word4", "word5"]);
    for (const chunk of chunks) {
      // No chunk exceeds maxChars unless a single word forces it
      expect(chunk.length <= 11 || chunk.split(/\s+/).length === 1).toBe(true);
    }
  });

  it("emits an oversized single word as its own chunk instead of infinite-looping", () => {
    expect(chunkText("verylongword short", 10)).toEqual([
      "verylongword",
      "short",
    ]);
  });

  it("trims leading/trailing whitespace on chunks split at word boundaries", () => {
    expect(chunkText("  word1  word2  ", 10)).toEqual(["word1", "word2"]);
  });
});

describe("TTS-1B: cache-lookup helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getTtsAudio", () => {
    it("queries the contentHash_language_voiceId_model composite unique key", async () => {
      vi.mocked(db.ttsAudio.findUnique).mockResolvedValue({ id: "t1" } as any);
      const result = await getTtsAudio({
        contentHash: "hash1",
        language: "en",
        voiceId: "v1",
        model: "m1",
      });
      expect(result).toEqual({ id: "t1" });
      expect(db.ttsAudio.findUnique).toHaveBeenCalledWith({
        where: {
          contentHash_language_voiceId_model: {
            contentHash: "hash1",
            language: "en",
            voiceId: "v1",
            model: "m1",
          },
        },
      });
    });
  });

  describe("createTtsAudio", () => {
    it("creates a ttsAudio record and returns it", async () => {
      vi.mocked(db.ttsAudio.create).mockResolvedValue({ id: "t2" } as any);
      const result = await createTtsAudio({
        contentHash: "hash1",
        language: "en",
        voiceId: "v1",
        model: "m1",
        provider: "elevenlabs",
        storagePath: "tts/hash1/v1_m1.mp3",
        fileSize: 1234,
      });
      expect(result).toEqual({ id: "t2" });
      expect(db.ttsAudio.create).toHaveBeenCalledWith({
        data: {
          contentHash: "hash1",
          language: "en",
          voiceId: "v1",
          model: "m1",
          provider: "elevenlabs",
          storagePath: "tts/hash1/v1_m1.mp3",
          fileSize: 1234,
        },
      });
    });
  });

  describe("getTtsProviderConfig", () => {
    it("queries the provider_userType composite unique key", async () => {
      vi.mocked(db.ttsProviderConfig.findUnique).mockResolvedValue({
        apiKey: "key",
        model: "m",
        voiceId: "v",
      } as any);
      const result = await getTtsProviderConfig("elevenlabs", "pro");
      expect(result).toEqual({ apiKey: "key", model: "m", voiceId: "v" });
      expect(db.ttsProviderConfig.findUnique).toHaveBeenCalledWith({
        where: {
          provider_userType: { provider: "elevenlabs", userType: "pro" },
        },
      });
    });
  });
});

describe("TTS-1C: generateTtsAudio orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Shared defaults: book exists, section has text, elevenlabs is configured.
  function setupDefaults(sectionText = "hello world") {
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({
      id: "b1",
      epubPath: "epubs/b1.epub",
      language: "en",
    } as any);
    vi.mocked(extractSectionText).mockResolvedValue(sectionText);
    vi.mocked(db.ttsProviderConfig.findUnique).mockResolvedValue({
      apiKey: "el-key",
      model: "eleven_multilingual_v2",
      voiceId: "v1",
    } as any);
    vi.mocked(storage.getUrl).mockReturnValue("/api/files/tts/out.mp3");
  }

  it("throws 'Book not found' when the book row is missing", async () => {
    vi.mocked(db.epubFile.findUnique).mockResolvedValue(null);
    await expect(
      generateTtsAudio({ bookId: "missing", sectionHref: "ch1", tier: "regular" })
    ).rejects.toThrow("Book not found");
  });

  it("throws 'Section text is empty' when extracted text is blank", async () => {
    setupDefaults("   ");
    await expect(
      generateTtsAudio({ bookId: "b1", sectionHref: "ch1", tier: "regular" })
    ).rejects.toThrow("Section text is empty");
  });

  it("throws with statusCode 503 when no provider is configured", async () => {
    setupDefaults("hello world");
    vi.mocked(db.ttsProviderConfig.findUnique).mockResolvedValue(null);
    await expect(
      generateTtsAudio({ bookId: "b1", sectionHref: "ch1", tier: "regular" })
    ).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringMatching(/TTS provider not configured/),
    });
  });

  it("throws statusCode 503 when both providers have null apiKey", async () => {
    setupDefaults("hello world");
    vi.mocked(db.ttsProviderConfig.findUnique).mockResolvedValue({
      apiKey: null,
      model: "m",
      voiceId: "v",
    } as any);
    await expect(
      generateTtsAudio({ bookId: "b1", sectionHref: "ch1", tier: "regular" })
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("returns cached audio on cache hit; provider and storage.write never called", async () => {
    setupDefaults("hello world");
    vi.mocked(db.ttsAudio.findUnique).mockResolvedValue({
      id: "cached-1",
      storagePath: "tts/hash/v1_m.mp3",
    } as any);

    const result = await generateTtsAudio({
      bookId: "b1",
      sectionHref: "ch1",
      tier: "regular",
    });

    expect(result).toEqual({
      cached: true,
      audioId: "cached-1",
      url: "/api/files/tts/out.mp3",
    });
    expect(callElevenLabs).not.toHaveBeenCalled();
    expect(callFalAi).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
    // getUrl IS called on cache hit (builds the URL from the cached row)
    expect(storage.getUrl).toHaveBeenCalledWith("tts/hash/v1_m.mp3");
  });

  it("on cache miss with elevenlabs, writes the concatenated buffer and creates a row", async () => {
    setupDefaults("hello world");
    vi.mocked(db.ttsAudio.findUnique).mockResolvedValue(null);
    vi.mocked(callElevenLabs).mockResolvedValue(Buffer.from("audio-bytes"));
    vi.mocked(db.ttsAudio.create).mockResolvedValue({ id: "new-1" } as any);

    const result = await generateTtsAudio({
      bookId: "b1",
      sectionHref: "ch1",
      tier: "regular",
    });

    expect(result.cached).toBe(false);
    expect(result.audioId).toBe("new-1");
    expect(callElevenLabs).toHaveBeenCalledTimes(1);
    expect(storage.write).toHaveBeenCalledTimes(1);

    const [writePath, writeBuf] = vi.mocked(storage.write).mock.calls[0];
    expect(writePath).toMatch(/^tts\//);
    expect(writeBuf).toEqual(Buffer.from("audio-bytes"));

    expect(db.ttsAudio.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: "elevenlabs",
        storagePath: writePath,
        fileSize: (writeBuf as Buffer).length,
      }),
    });
  });

  it("falls back to fal when elevenlabs apiKey is null", async () => {
    setupDefaults("hello world");
    vi.mocked(db.ttsAudio.findUnique).mockResolvedValue(null);
    // First call: elevenlabs config with null apiKey; second call: fal config valid.
    vi.mocked(db.ttsProviderConfig.findUnique)
      .mockResolvedValueOnce({ apiKey: null, model: "el-m", voiceId: "el-v" } as any)
      .mockResolvedValueOnce({ apiKey: "fal-key", model: "fal-m", voiceId: "fal-v" } as any);
    vi.mocked(callFalAi).mockResolvedValue(Buffer.from("fal-bytes"));
    vi.mocked(db.ttsAudio.create).mockResolvedValue({ id: "fal-new" } as any);

    const result = await generateTtsAudio({
      bookId: "b1",
      sectionHref: "ch1",
      tier: "regular",
    });

    expect(callElevenLabs).not.toHaveBeenCalled();
    expect(callFalAi).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
    expect(result.audioId).toBe("fal-new");
    expect(db.ttsAudio.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: "fal" }),
    });
  });

  it("splits long text into multiple chunks and calls the provider once per chunk", async () => {
    // Three 2000-char paragraphs separated by \n\n -> 3 chunks (each under MAX_CHARS=5000).
    const longText =
      "a".repeat(2000) + "\n\n" + "b".repeat(2000) + "\n\n" + "c".repeat(2000);
    setupDefaults(longText);
    vi.mocked(db.ttsAudio.findUnique).mockResolvedValue(null);
    vi.mocked(callElevenLabs).mockResolvedValue(Buffer.from("chunk-audio"));
    vi.mocked(db.ttsAudio.create).mockResolvedValue({ id: "multi-1" } as any);

    await generateTtsAudio({
      bookId: "b1",
      sectionHref: "ch1",
      tier: "regular",
    });

    expect(callElevenLabs).toHaveBeenCalledTimes(3);
    expect(storage.write).toHaveBeenCalledTimes(1);
    // The buffer written is Buffer.concat of the three chunk buffers.
    const [, writeBuf] = vi.mocked(storage.write).mock.calls[0];
    expect(writeBuf).toEqual(
      Buffer.concat([
        Buffer.from("chunk-audio"),
        Buffer.from("chunk-audio"),
        Buffer.from("chunk-audio"),
      ])
    );
  });

  it("on P2002 race, falls back to getTtsAudio and returns the winner's row", async () => {
    setupDefaults("hello world");
    vi.mocked(callElevenLabs).mockResolvedValue(Buffer.from("audio"));
    vi.mocked(db.ttsAudio.create).mockRejectedValue({ code: "P2002" } as never);
    // First findUnique (cache check) -> miss; second (race fallback) -> winner.
    vi.mocked(db.ttsAudio.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "winner-1",
        storagePath: "tts/winner.mp3",
      } as any);

    const result = await generateTtsAudio({
      bookId: "b1",
      sectionHref: "ch1",
      tier: "regular",
    });

    expect(result).toEqual({
      cached: true,
      audioId: "winner-1",
      url: "/api/files/tts/out.mp3",
    });
    expect(storage.getUrl).toHaveBeenCalledWith("tts/winner.mp3");
  });

  it("rethrows non-P2002 errors from createTtsAudio", async () => {
    setupDefaults("hello world");
    vi.mocked(db.ttsAudio.findUnique).mockResolvedValue(null);
    vi.mocked(callElevenLabs).mockResolvedValue(Buffer.from("audio"));
    vi.mocked(db.ttsAudio.create).mockRejectedValue(
      new Error("DB connection lost")
    );

    await expect(
      generateTtsAudio({ bookId: "b1", sectionHref: "ch1", tier: "regular" })
    ).rejects.toThrow("DB connection lost");
  });
});
