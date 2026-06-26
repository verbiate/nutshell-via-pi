import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    explainer: {
      findFirst: vi.fn(),
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
  getLatestExplainer,
  createExplainer,
  computeContentHash,
  computeExplainerContentHash,
} from "@/server/services/explainer";
import { fillTemplate } from "@/server/services/prompt-builder";

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

    it("differs when extraSalt is supplied vs omitted", () => {
      const h1 = computeContentHash("hello", 1, "book");
      const h2 = computeContentHash("hello", 1, "book", undefined, "twoPass:3");
      expect(h1).not.toBe(h2);
    });

    it("differs by extraSalt value (pass-2 version bump invalidates cache)", () => {
      const h1 = computeContentHash("hello", 1, "book", undefined, "twoPass:3");
      const h2 = computeContentHash("hello", 1, "book", undefined, "twoPass:4");
      expect(h1).not.toBe(h2);
    });
  });

  describe("computeExplainerContentHash (single source of truth)", () => {
    // ponytail: the whole point of this helper is that the writer (generation)
    // and reader (lookup) can never drift. Pin the formula so a refactor that
    // breaks parity fails loudly here instead of silently always-missing.
    it("omits bookMd5 for book type (sourceText IS the book)", () => {
      const withoutMd5 = computeExplainerContentHash({
        type: "book",
        sourceText: "x",
        bookMd5: "md5",
        promptVersion: 1,
      });
      const reference = computeContentHash("x", 1, "book");
      expect(withoutMd5).toBe(reference);
    });

    it("includes bookMd5 for section and passage (same text, different book → different row)", () => {
      const a = computeExplainerContentHash({
        type: "passage",
        sourceText: "x",
        bookMd5: "md5-a",
        promptVersion: 1,
      });
      const b = computeExplainerContentHash({
        type: "passage",
        sourceText: "x",
        bookMd5: "md5-b",
        promptVersion: 1,
      });
      expect(a).not.toBe(b);
    });

    it("assembles twoPass + metadata salts as 'twoPass:N|meta:M'", () => {
      const withSalts = computeExplainerContentHash({
        type: "book",
        sourceText: "x",
        bookMd5: "md5",
        promptVersion: 1,
        twoPassVersion: 3,
        metadataVersion: "2026-01-01",
      });
      const reference = computeContentHash(
        "x",
        1,
        "book",
        undefined,
        "twoPass:3|meta:2026-01-01"
      );
      expect(withSalts).toBe(reference);
    });

    it("omits the salt entirely when neither twoPass nor metadata apply", () => {
      const noSalt = computeExplainerContentHash({
        type: "book",
        sourceText: "x",
        bookMd5: "md5",
        promptVersion: 1,
      });
      const reference = computeContentHash("x", 1, "book");
      expect(noSalt).toBe(reference);
    });
  });

  describe("getLatestExplainer", () => {
    it("queries the 4-axis key ordered by version desc (versioned cache)", async () => {
      vi.mocked(db.explainer.findFirst).mockResolvedValue(null);
      await getLatestExplainer({
        contentHash: "abc",
        language: "en",
        contentType: "book",
        tier: "regular",
      });
      expect(db.explainer.findFirst).toHaveBeenCalledWith({
        where: {
          contentHash: "abc",
          language: "en",
          contentType: "book",
          tier: "regular",
        },
        orderBy: { version: "desc" },
      });
    });
  });

  describe("createExplainer (versioning)", () => {
    it("sets version = max(existing) + 1 for the key", async () => {
      // ponytail: a re-reroll must NOT overwrite — it creates the next version.
      vi.mocked(db.explainer.findFirst).mockResolvedValue({ version: 4 } as any);
      vi.mocked(db.explainer.create).mockResolvedValue({ id: "e1", version: 5 } as any);
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
          version: 5,
        }),
      });
    });

    it("starts at version 1 when no existing row exists", async () => {
      vi.mocked(db.explainer.findFirst).mockResolvedValue(null);
      vi.mocked(db.explainer.create).mockResolvedValue({ id: "e1", version: 1 } as any);
      await createExplainer({
        contentHash: "abc",
        language: "en",
        contentType: "book",
        tier: "regular",
        content: "explanation",
        modelId: "m",
        promptVersion: 1,
      });
      expect(db.explainer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 1 }),
      });
    });
  });
});

describe("EXP-03: Passage explainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getLatestExplainer accepts passage contentType", async () => {
    vi.mocked(db.explainer.findFirst).mockResolvedValue(null);
    await getLatestExplainer({
      contentHash: "abc",
      language: "en",
      contentType: "passage",
      tier: "regular",
    });
    expect(db.explainer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contentType: "passage" }),
      })
    );
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

describe("fillTemplate: two-pass tokens", () => {
  it("substitutes {{previous_response}} and {{book_text}}", () => {
    const prompt = fillTemplate(
      "Source: {{book_text}}\nDraft: {{previous_response}}",
      {
        book_text: "BOOK",
        previous_response: "DRAFT",
      }
    );
    expect(prompt).toBe("Source: BOOK\nDraft: DRAFT");
  });

  it("leaves unknown tokens as empty strings (fillTemplate contract)", () => {
    // ponytail: this is the silent-failure mode admins hit if they typo a
    // token name. Pinning the behavior so a future "stricter" change is
    // intentional and visible.
    const prompt = fillTemplate("[{{missing_token}}]", {});
    expect(prompt).toBe("[]");
  });
});
