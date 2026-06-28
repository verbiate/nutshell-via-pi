import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../query", () => ({ answerShelfQuestion: vi.fn() }));
vi.mock("../wiki-storage", () => ({ wikiExists: vi.fn() }));

import { answerShelfQuestion } from "../query";
import { wikiExists } from "../wiki-storage";
import { OkfContextSource } from "../okf-context-source";

// ponytail: a representative ShelfAnswer — non-empty citations path.
const HAPPY_ANSWER = {
  prompt: "You are Nutshell's ask-your-bookshelf assistant...\n\nCourage is bravery.\n\nSources:\n- Book A — Courage",
  sourceText: "## Courage (from bookA)\nbravery in action",
  bookText: "## Courage (from bookA)\nbravery in action",
  bookMd5: "shelf:deadbeef",
  promptVersion: 1,
  citations: [{ bookId: "bookA", bookTitle: "Book A", conceptTitle: "Courage" }],
};

const FALLBACK_ANSWER = {
  prompt: "I couldn't find relevant concepts in your library for that question.",
  sourceText: "",
  bookText: "",
  bookMd5: "shelf:deadbeef",
  promptVersion: 1,
  citations: [],
};

describe("OkfContextSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(wikiExists).mockResolvedValue(true);
    vi.mocked(answerShelfQuestion).mockResolvedValue(HAPPY_ANSWER as never);
  });

  describe("isReady", () => {
    it("true when wikiExists('index.md') is true", async () => {
      const src = new OkfContextSource();
      expect(await src.isReady()).toBe(true);
      expect(wikiExists).toHaveBeenCalledWith("index.md");
    });

    it("false when wikiExists('index.md') is false", async () => {
      vi.mocked(wikiExists).mockResolvedValue(false);
      const src = new OkfContextSource();
      expect(await src.isReady()).toBe(false);
      expect(wikiExists).toHaveBeenCalledWith("index.md");
    });
  });

  describe("buildContext", () => {
    it("delegates to answerShelfQuestion with {question, accessibleBookIds} (no userId)", async () => {
      const src = new OkfContextSource();
      await src.buildContext({
        question: "What is courage?",
        userId: "user-42",
        accessibleBookIds: ["bookA", "bookB"],
      });

      expect(answerShelfQuestion).toHaveBeenCalledTimes(1);
      expect(answerShelfQuestion).toHaveBeenCalledWith({
        question: "What is courage?",
        accessibleBookIds: ["bookA", "bookB"],
      });
    });

    it("maps ShelfAnswer fields to BuiltPrompt; bookText == sourceText; promptVersion bumped to 2", async () => {
      const src = new OkfContextSource();
      const out = await src.buildContext({
        question: "q",
        userId: "user-1",
        accessibleBookIds: ["bookA"],
      });

      expect(out.prompt).toBe(HAPPY_ANSWER.prompt);
      expect(out.sourceText).toBe(HAPPY_ANSWER.sourceText);
      expect(out.bookText).toBe(HAPPY_ANSWER.sourceText); // bookText mirrors sourceText
      expect(out.bookMd5).toBe(HAPPY_ANSWER.bookMd5); // shelf:<accessHash> from query
      expect(out.promptVersion).toBe(2); // bumped from the stub's 1
      expect(out.metadataVersion).toBeUndefined();
    });

    it("fallback answer (empty citations) still yields a valid BuiltPrompt", async () => {
      vi.mocked(answerShelfQuestion).mockResolvedValue(FALLBACK_ANSWER as never);
      const src = new OkfContextSource();
      const out = await src.buildContext({
        question: "q",
        userId: "user-1",
        accessibleBookIds: ["bookZ"],
      });

      expect(out.prompt).toBe(FALLBACK_ANSWER.prompt);
      expect(out.sourceText).toBe("");
      expect(out.bookText).toBe("");
      expect(out.bookMd5).toBe(FALLBACK_ANSWER.bookMd5);
      expect(out.promptVersion).toBe(2);
    });
  });
});
