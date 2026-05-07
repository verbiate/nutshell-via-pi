import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    explainer: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    promptTemplate: {
      findUnique: vi.fn(),
    },
    epubFile: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/server/storage/local", () => ({
  storage: {
    read: vi.fn(),
  },
}));

vi.mock("@likecoin/epub-ts", () => ({
  Book: vi.fn(() => ({
    open: vi.fn(),
    spine: { get: vi.fn() },
    destroy: vi.fn(),
  })),
}));

import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import {
  getExplainer,
  createExplainer,
  computeContentHash,
} from "@/server/services/explainer";

describe("EXP-05/06: Explainer cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("computeContentHash", () => {
    it("produces deterministic SHA-256 hex", () => {
      const h1 = computeContentHash("hello", 1, "book");
      const h2 = computeContentHash("hello", 1, "book");
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("differs by promptType", () => {
      const h1 = computeContentHash("hello", 1, "book");
      const h2 = computeContentHash("hello", 1, "section");
      expect(h1).not.toBe(h2);
    });

    it("differs by promptVersion", () => {
      const h1 = computeContentHash("hello", 1, "book");
      const h2 = computeContentHash("hello", 2, "book");
      expect(h1).not.toBe(h2);
    });
  });

  describe("getExplainer", () => {
    it("queries composite unique key", async () => {
      vi.mocked(db.explainer.findUnique).mockResolvedValue(null);
      await getExplainer({
        contentHash: "abc",
        language: "en",
        contentType: "book",
        tier: "regular",
      });
      expect(db.explainer.findUnique).toHaveBeenCalledWith({
        where: {
          contentHash_language_contentType_tier: {
            contentHash: "abc",
            language: "en",
            contentType: "book",
            tier: "regular",
          },
        },
      });
    });
  });

  describe("createExplainer", () => {
    it("creates explainer record", async () => {
      vi.mocked(db.explainer.create).mockResolvedValue({ id: "e1" } as any);
      await createExplainer({
        contentHash: "abc",
        language: "en",
        contentType: "book",
        tier: "regular",
        content: "explanation",
        modelId: "google/gemini-2.0-flash-001",
        promptVersion: 1,
      });
      expect(db.explainer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentHash: "abc",
          content: "explanation",
          modelId: "google/gemini-2.0-flash-001",
        }),
      });
    });
  });
});

describe("EXP-07: Grounding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildBookPrompt reads TXT and substitutes variables", async () => {
    const { buildBookPrompt } = await import("@/server/services/prompt-builder");
    vi.mocked(db.epubFile.findUnique).mockResolvedValue({
      id: "b1",
      title: "Test Book",
      author: "Test Author",
      language: "en",
      txtPath: "txts/b1.txt",
      tocJson: null,
      epubPath: "epubs/b1.epub",
    } as any);
    vi.mocked(db.promptTemplate.findUnique).mockResolvedValue({
      type: "book",
      content: "Title: {{title}}\nText: {{text}}",
      version: 1,
    } as any);
    vi.mocked(storage.read).mockResolvedValue(Buffer.from("hello world"));

    const result = await buildBookPrompt("b1", "vi");
    expect(result.sourceText).toBe("hello world");
    expect(result.prompt).toContain("Title: Test Book");
    expect(result.prompt).toContain("Text: hello world");
    expect(result.promptVersion).toBe(1);
  });
});
