import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../wiki-storage", () => ({ readWikiFile: vi.fn() }));
vi.mock("../llm-json", () => ({ completeJson: vi.fn() }));
vi.mock("../cache", () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}));
vi.mock("@/server/db", () => ({
  db: { epubFile: { findMany: vi.fn() } },
}));

import { readWikiFile } from "../wiki-storage";
import { completeJson } from "../llm-json";
import { getCached, setCached } from "../cache";
import { db } from "@/server/db";
import { answerShelfQuestion, QUERY_PROMPT_VERSION } from "../query";

// Index fixture mirrors render.ts buildIndex output. bookA + bookB are
// accessible; bookC is NOT (its concept must be filtered out at every layer).
const INDEX_MD = `# Shelf Wiki

## heroism

### Concepts
- **bookA**
  - [Courage](concepts/bookA/courage.md) — bravery in action
- **bookB**
  - [Valor](concepts/bookB/valor.md) — boldness under fire
- **bookC**
  - [Secrecy](concepts/bookC/secrecy.md) — hidden motives
`;

function conceptBody(
  title: string,
  bookId: string,
  desc: string,
): string {
  // Mirrors render.ts conceptToMarkdown frontmatter + body shape.
  return `---
type: "theme"
title: "${title}"
sourceBookId: "${bookId}"
topic: "heroism"
---

# ${title}

## description
${desc}
`;
}

const COURAGE_BODY = conceptBody("Courage", "bookA", "bravery in action");
const VALOR_BODY = conceptBody("Valor", "bookB", "boldness under fire");
const SECRECY_BODY = conceptBody("Secrecy", "bookC", "hidden motives");

function setupReadWiki() {
  vi.mocked(readWikiFile).mockImplementation(async (rel) => {
    if (rel === "index.md") return INDEX_MD;
    if (rel === "concepts/bookA/courage.md") return COURAGE_BODY;
    if (rel === "concepts/bookB/valor.md") return VALOR_BODY;
    if (rel === "concepts/bookC/secrecy.md") return SECRECY_BODY;
    throw new Error(`unexpected readWikiFile: ${rel}`);
  });
}

function setupDbTitles(map: Record<string, string>) {
  vi.mocked(db.epubFile.findMany).mockResolvedValue(
    Object.entries(map).map(([id, title]) => ({ id, title })) as never,
  );
}

describe("answerShelfQuestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCached).mockResolvedValue(null);
    vi.mocked(setCached).mockResolvedValue(undefined);
    vi.mocked(completeJson).mockResolvedValue({ answer: "default answer" });
    setupReadWiki();
    setupDbTitles({ bookA: "Book A", bookB: "Book B", bookC: "Book C" });
  });

  it("happy path: navigate selects concepts, reads them, answers using accessible concepts only", async () => {
    // navigate picks bookA's concept
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if ("conceptRelPaths" in (a as { validate: unknown })) {
        // navigate call — distinguish by prompt content instead (below)
      }
      return { answer: "ANSH" } as never;
    });
    // ponytail: use prompt content to route nav vs answer (both are completeJson).
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "Courage is bravery in action." } as never;
    });

    const result = await answerShelfQuestion({
      question: "What is courage?",
      accessibleBookIds: ["bookA", "bookB"],
    });

    // two LLM calls: navigate + answer
    expect(completeJson).toHaveBeenCalledTimes(2);

    // bookA concept was read
    expect(readWikiFile).toHaveBeenCalledWith("concepts/bookA/courage.md");

    // answer used in final prompt
    expect(result.prompt).toContain("Courage is bravery in action.");
    expect(result.prompt).toContain(
      "You are Nutshell's ask-your-bookshelf assistant",
    );

    // sourceText == joined concept bodies == bookText (shelf has no separate book)
    expect(result.sourceText).toBe(COURAGE_BODY);
    expect(result.bookText).toBe(result.sourceText);

    // bookMd5 is the synthetic shelf identifier
    expect(result.bookMd5).toBe("shelf:" + hashOf(["bookA", "bookB"]));
    expect(result.bookMd5.startsWith("shelf:")).toBe(true);

    // promptVersion is the constant
    expect(result.promptVersion).toBe(QUERY_PROMPT_VERSION);

    // citations resolve via db lookup
    expect(result.citations).toEqual([
      { bookId: "bookA", bookTitle: "Book A", conceptTitle: "Courage" },
    ]);
    expect(db.epubFile.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["bookA"] } },
      select: { id: true, title: true },
    });
  });

  it("access filter: index has an inaccessible bookC concept — it is never read, never in nav's known set, never cited", async () => {
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookB/valor.md"] } as never;
      }
      return { answer: "Valor is boldness." } as never;
    });

    const result = await answerShelfQuestion({
      question: "Tell me about valor",
      accessibleBookIds: ["bookA", "bookB"], // bookC NOT accessible
    });

    // The nav prompt (handed to completeJson) MUST NOT list the bookC concept.
    const navCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("Available concepts"),
    )!;
    expect(navCall).toBeTruthy();
    expect(navCall[0].prompt).not.toContain("concepts/bookC/secrecy.md");
    expect(navCall[0].prompt).not.toContain("Secrecy");

    // bookC's concept file is NEVER read.
    expect(readWikiFile).not.toHaveBeenCalledWith("concepts/bookC/secrecy.md");

    // bookC never appears in citations.
    expect(result.citations.every((c) => c.bookId !== "bookC")).toBe(true);
  });

  it("read-time defense-in-depth: an inaccessible path returned by nav is dropped and never read", async () => {
    // ponytail: simulate validator bypass — nav mock returns an inaccessible
    // path alongside an accessible one. The read-time filter must drop it.
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return {
          conceptRelPaths: [
            "concepts/bookA/courage.md",
            "concepts/bookC/secrecy.md", // bookC not accessible
          ],
        } as never;
      }
      return { answer: "ok" } as never;
    });

    const result = await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA", "bookB"],
    });

    // only the accessible concept read
    expect(readWikiFile).toHaveBeenCalledWith("concepts/bookA/courage.md");
    expect(readWikiFile).not.toHaveBeenCalledWith("concepts/bookC/secrecy.md");

    // answer prompt only contains the accessible concept
    const answerCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("Concept excerpts"),
    )!;
    expect(answerCall[0].prompt).toContain("Courage");
    expect(answerCall[0].prompt).not.toContain("Secrecy");

    // citation only for accessible
    expect(result.citations.map((c) => c.bookId)).toEqual(["bookA"]);
  });

  it("empty filtered index → fallback answer, empty citations, NO completeJson call", async () => {
    // Access set matches no concept in the index → filtered index empty.
    const result = await answerShelfQuestion({
      question: "anything",
      accessibleBookIds: ["bookZ"],
    });

    expect(result.prompt).toBe(
      "I couldn't find any relevant concepts in books you have access to for that.",
    );
    expect(result.citations).toEqual([]);
    expect(result.sourceText).toBe("");
    expect(result.bookText).toBe("");
    expect(completeJson).not.toHaveBeenCalled();
    // concept files never read either
    expect(readWikiFile).not.toHaveBeenCalledWith(
      expect.stringContaining("concepts/"),
    );
  });

  it("invented conceptRelPath in navigate → validate rejects → retry returns good", async () => {
    const good = { conceptRelPaths: ["concepts/bookA/courage.md"] };
    const invented = { conceptRelPaths: ["concepts/fake/invented.md"] };

    // ponytail: mirrors synthesize.test — simulate completeJson's internal
    // retry by exercising the validate guard directly.
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.validate(invented)) return invented as never;
      return good as never;
    });

    const result = await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA", "bookB"],
    });

    // Directly prove the validator rejects the invented path (would trigger retry)
    const navCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("Available concepts"),
    )!;
    expect(navCall[0].validate(invented)).toBe(false);
    expect(navCall[0].validate(good)).toBe(true);

    // the good path was used → bookA cited
    expect(result.citations.map((c) => c.bookId)).toEqual(["bookA"]);
  });

  it("navigate caps selected concepts at the limit (≤5)", async () => {
    // ponytail: build an index with 7 accessible concepts in one book; nav
    // returns all 7; assert only 5 are read + 5 cited.
    vi.mocked(readWikiFile).mockImplementation(async (rel) => {
      if (rel === "index.md") {
        const lines = ["# Shelf Wiki", "", "## t", "", "### Concepts", "- **bookA**"];
        for (let i = 0; i < 7; i++) {
          lines.push(`  - [C${i}](concepts/bookA/c${i}.md) — d${i}`);
        }
        return lines.join("\n") + "\n";
      }
      const m = rel.match(/concepts\/bookA\/c(\d)\.md/);
      if (m) return conceptBody(`C${m[1]}`, "bookA", `d${m[1]}`);
      throw new Error(`unexpected: ${rel}`);
    });
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return {
          conceptRelPaths: Array.from({ length: 7 }, (_, i) => `concepts/bookA/c${i}.md`),
        } as never;
      }
      return { answer: "a" } as never;
    });

    const result = await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA"],
    });

    expect(result.citations).toHaveLength(5);
    const readConceptCalls = vi.mocked(readWikiFile).mock.calls.filter(
      ([r]) => typeof r === "string" && r.startsWith("concepts/bookA/c"),
    );
    expect(readConceptCalls).toHaveLength(5);
  });

  it("navigate returns empty → 'couldn't find relevant' fallback", async () => {
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: [] } as never;
      }
      return { answer: "x" } as never;
    });

    const result = await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA", "bookB"],
    });

    expect(result.prompt).toBe(
      "I couldn't find relevant concepts in your library for that question.",
    );
    expect(result.citations).toEqual([]);
    // nav LLM ran, answer LLM did NOT
    const calls = vi.mocked(completeJson).mock.calls;
    expect(calls.some((c) => c[0].prompt.includes("Available concepts"))).toBe(true);
    expect(calls.some((c) => c[0].prompt.includes("Concept excerpts"))).toBe(false);
  });

  it("cache hit on BOTH nav + answer → completeJson never called; files still read for sourceText/citations", async () => {
    vi.mocked(getCached).mockImplementation(async (ns) => {
      if (ns === "query-nav") {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      if (ns === "query-answer") {
        return { answer: "cached answer" } as never;
      }
      return null as never;
    });

    const result = await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA", "bookB"],
    });

    expect(completeJson).not.toHaveBeenCalled();
    // files read to assemble sourceText + citations
    expect(readWikiFile).toHaveBeenCalledWith("concepts/bookA/courage.md");
    expect(result.prompt).toContain("cached answer");
    expect(result.citations).toHaveLength(1);
  });

  it("cache hit on navigate only → nav LLM skipped, answer LLM still runs; nav cache checked with question+accessHash key", async () => {
    vi.mocked(getCached).mockImplementation(async (ns) => {
      if (ns === "query-nav") {
        return { conceptRelPaths: ["concepts/bookB/valor.md"] } as never;
      }
      return null as never;
    });
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        throw new Error("nav should be cached — must not call LLM");
      }
      return { answer: "fresh answer" } as never;
    });

    const result = await answerShelfQuestion({
      question: "What is valor?",
      accessibleBookIds: ["bookA", "bookB"],
    });

    // exactly one LLM call (the answer)
    expect(completeJson).toHaveBeenCalledTimes(1);
    expect(completeJson).not.toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining("Available concepts") }),
    );
    expect(result.prompt).toContain("fresh answer");
    expect(result.citations.map((c) => c.bookId)).toEqual(["bookB"]);

    // nav cache key = question + null-byte + accessHash
    const navGetCall = vi.mocked(getCached).mock.calls.find(
      ([ns]) => ns === "query-nav",
    )!;
    const [, input] = navGetCall;
    const expectedHash = hashOf(["bookA", "bookB"]);
    expect(input).toBe(`What is valor?\x00${expectedHash}`);
  });

  it("cache writes: nav result + answer result both persisted with stable keys", async () => {
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "ans" } as never;
    });

    await answerShelfQuestion({
      question: "Q1",
      accessibleBookIds: ["bookB", "bookA"], // unsorted on purpose
    });

    // nav persisted with sorted-access hash (access-set order must not fragment key)
    const navSet = vi.mocked(setCached).mock.calls.find(
      ([ns]) => ns === "query-nav",
    )!;
    expect(navSet).toBeTruthy();
    const [, navInput, navVal] = navSet;
    const expectedHash = hashOf(["bookA", "bookB"]);
    expect(navInput).toBe(`Q1\x00${expectedHash}`);
    expect(navVal).toEqual({ conceptRelPaths: ["concepts/bookA/courage.md"] });

    // answer persisted with question + accessHash + sorted selected paths
    const ansSet = vi.mocked(setCached).mock.calls.find(
      ([ns]) => ns === "query-answer",
    )!;
    const [, ansInput, ansVal] = ansSet;
    expect(ansInput).toBe(
      `Q1\x00${expectedHash}\x00concepts/bookA/courage.md`,
    );
    expect(ansVal).toEqual({ answer: "ans" });
  });

  it("bookMd5 = 'shelf:' + sha256(sorted access set); stable across access-set order", async () => {
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "a" } as never;
    });

    const a = await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA", "bookB"],
    });
    const b = await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookB", "bookA"],
    });

    expect(a.bookMd5).toBe(b.bookMd5);
    expect(a.bookMd5).toBe("shelf:" + hashOf(["bookA", "bookB"]));
  });

  it("index.md unreadable (wiki not built) → treated as empty → fallback, no LLM", async () => {
    vi.mocked(readWikiFile).mockRejectedValue(new Error("ENOENT"));

    const result = await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA"],
    });

    expect(result.prompt).toBe(
      "I couldn't find any relevant concepts in books you have access to for that.",
    );
    expect(result.citations).toEqual([]);
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("resilience: a corrupt/missing concept among the selected set is skipped, the rest are still used", async () => {
    // ponytail: nav selects bookA courage + bookB valor; bookA's file is
    // unreadable (corrupt/missing on disk). bookA must be dropped from
    // sourceText/citations/answer-prompt; bookB proceeds normally.
    vi.mocked(readWikiFile).mockImplementation(async (rel) => {
      if (rel === "index.md") return INDEX_MD;
      if (rel === "concepts/bookA/courage.md") {
        throw new Error("ENOENT: corrupt concept file");
      }
      if (rel === "concepts/bookB/valor.md") return VALOR_BODY;
      throw new Error(`unexpected readWikiFile: ${rel}`);
    });
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return {
          conceptRelPaths: [
            "concepts/bookA/courage.md",
            "concepts/bookB/valor.md",
          ],
        } as never;
      }
      return { answer: "Valor is boldness." } as never;
    });

    const result = await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA", "bookB"],
    });

    // bookA was attempted but failed; bookB was read and is the only citation.
    expect(readWikiFile).toHaveBeenCalledWith("concepts/bookA/courage.md");
    expect(readWikiFile).toHaveBeenCalledWith("concepts/bookB/valor.md");
    expect(result.citations.map((c) => c.bookId)).toEqual(["bookB"]);

    // answer prompt only contains the successfully-read concept.
    const answerCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("Concept excerpts"),
    )!;
    expect(answerCall[0].prompt).toContain("Valor");
    expect(answerCall[0].prompt).not.toContain("Courage");

    // sourceText reflects only the read concept.
    expect(result.sourceText).toBe(VALOR_BODY);
    expect(result.prompt).toContain("Valor is boldness.");
  });

  it("resilience: ALL selected concepts fail to read → nothing-found fallback, empty citations, no answer LLM", async () => {
    // ponytail: nav selects an accessible concept, but its file is unreadable.
    // With no concepts loadable, the query must degrade to the fallback answer
    // instead of throwing/500ing.
    vi.mocked(readWikiFile).mockImplementation(async (rel) => {
      if (rel === "index.md") return INDEX_MD;
      if (rel === "concepts/bookA/courage.md") {
        throw new Error("ENOENT: corrupt concept file");
      }
      throw new Error(`unexpected readWikiFile: ${rel}`);
    });
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      // answer LLM must NOT run — no concepts to ground on.
      throw new Error("answer LLM should not run when no concepts loaded");
    });

    const result = await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA", "bookB"],
    });

    expect(result.prompt).toBe(
      "I couldn't find relevant concepts in your library for that question.",
    );
    expect(result.citations).toEqual([]);
    expect(result.sourceText).toBe("");
    // nav LLM ran; answer LLM did NOT.
    const calls = vi.mocked(completeJson).mock.calls;
    expect(calls.some((c) => c[0].prompt.includes("Available concepts"))).toBe(true);
    expect(calls.some((c) => c[0].prompt.includes("Concept excerpts"))).toBe(false);
  });
});

// ponytail: mirror the production access-hash so tests assert the exact key
// contract without importing crypto internals from query.ts.
import crypto from "node:crypto";
function hashOf(ids: string[]): string {
  return crypto.createHash("sha256").update([...ids].sort().join(",")).digest("hex");
}
