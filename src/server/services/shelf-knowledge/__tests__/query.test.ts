import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../wiki-storage", () => ({ readWikiFile: vi.fn() }));
vi.mock("../llm-json", () => ({ completeJson: vi.fn() }));
vi.mock("../cache", () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}));
vi.mock("@/server/db", () => ({
  db: {
    epubFile: { findMany: vi.fn() },
    promptTemplate: { findUnique: vi.fn() },
  },
}));

import { readWikiFile } from "../wiki-storage";
import { completeJson } from "../llm-json";
import { getCached, setCached } from "../cache";
import { db } from "@/server/db";
import { answerShelfQuestion } from "../query";

// ponytail: by default the DB returns verbatim seeded content (= the in-code
// fallbacks) with version 1, so existing assertions on prompt content still
// hold. Per-type overrides happen in individual tests.
const NAV_DEFAULT_CONTENT = `You are navigating the user's library knowledge base to find concepts relevant to their question.

Available concepts (only from books the user has access to):
{{listing}}
{{conversation}}
User question: {{question}}

Return ONLY valid JSON matching this schema:
{
  "conceptRelPaths": ["<a path from the list above>"]
}

Constraints:
- Every conceptRelPath MUST be one of the exact paths listed above — do not invent or alter them.
- Pick only concepts relevant to answering the question.
- The latest question may refer to something in the recent conversation (e.g. "those", "deep links for that", "the startup one") — pick concepts relevant in that context.
- Select at most 5.
- If none are relevant, return an empty array.`;

const ANSWER_DEFAULT_CONTENT = `Answer the user's question using ONLY the provided concept excerpts from their library knowledge base.
{{conversation}}
User question: {{question}}

Concept excerpts:
{{concept_excerpts}}

Library manifest — every book the user has access to. Each entry is a ready-to-use link to open the book; copy the (#book:…) href verbatim and reword the label if you like:
{{library_manifest}}

Book index — books cited in the excerpts above (a subset of the library). Each entry is a ready-to-use link to open the book itself; copy the (#book:…) href verbatim and reword the label if you like:
{{book_index}}

Chapter maps for cited books — each entry is a ready-to-use link to a specific chapter; copy the (#ch:…) href verbatim (including the <bookId>: prefix) and reword the label if you like:
{{chapter_maps}}

Weave citations INTO THE VISIBLE REPLY as inline links:
- For a claim about the book as a whole (mentioning the book, its thesis, its author, recommending it), use the book form: [Book Title](#book:<bookId>) with hrefs copied verbatim from the library manifest or book index above. You may mention books from the library manifest when their title or subject is relevant to the question, even if no concept excerpt was read from them — link them with the #book: form. One book-level link per book referenced.
- For a claim grounded in a specific passage, use the chapter form: [Chapter Label](#ch:<bookId>:<basename>) with hrefs copied verbatim from the chapter maps above. One chapter link per grounded claim. Chapter links require a concept excerpt to have been read from that book — do not invent chapter hrefs for books that only appear in the library manifest.
Do NOT add a separate "Sources:" list; the inline links ARE the citations. Do not invent hrefs that are not in the library manifest, book index, or chapter maps.

Answer using ONLY the information in these excerpts plus the book titles in the library manifest. If the excerpts do not contain the answer but a library book's title suggests it may be relevant, say so plainly and link the book. Do not use outside knowledge beyond what the excerpts and titles provide.

Return ONLY valid JSON matching this schema:
{ "answer": "<your grounded answer with inline #book: and #ch: links>" }`;

// ponytail: mirror the seeded versions (prisma/seed.ts) so cache-key assertions
// reflect the live contract. Nav=2, answer=6 after the {{token_budget}} bump.
const SEEDED_NAV_VERSION = 2;
const SEEDED_ANSWER_VERSION = 6;
// ponytail: fallback (missing DB row) mirrors the seeded default — same versions.
const FALLBACK_NAV_VERSION = 2;
const FALLBACK_ANSWER_VERSION = 6;

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
    // ponytail: default DB templates = seeded content + version 1 so existing
    // assertions on prompt text/cache keys still hold. Per-test overrides
    // replace this mock where needed.
    vi.mocked(db.promptTemplate.findUnique).mockImplementation((async ({
      where,
    }: {
      where: { type: string };
    }) => {
      if (where.type === "shelf_nav") {
        return { content: NAV_DEFAULT_CONTENT, version: SEEDED_NAV_VERSION };
      }
      if (where.type === "shelf_answer") {
        return { content: ANSWER_DEFAULT_CONTENT, version: SEEDED_ANSWER_VERSION };
      }
      return null;
    }) as never);
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

    // promptVersion = loaded shelf_answer template version (seeded = 5)
    expect(result.promptVersion).toBe(SEEDED_ANSWER_VERSION);

    // citations resolve via db lookup
    expect(result.citations).toEqual([
      { bookId: "bookA", bookTitle: "Book A", conceptTitle: "Courage" },
    ]);
    expect(db.epubFile.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["bookA"] } },
      select: { id: true, title: true, tocJson: true },
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

    // nav cache key = question + null-byte + accessHash + nav template version + historyHash
    const navGetCall = vi.mocked(getCached).mock.calls.find(
      ([ns]) => ns === "query-nav",
    )!;
    const [, input] = navGetCall;
    const expectedHash = hashOf(["bookA", "bookB"]);
    expect(input).toBe(
      `What is valor?\x00${expectedHash}\x00${SEEDED_NAV_VERSION}\x00${histHashOf()}`,
    );
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

    // nav persisted with sorted-access hash + nav template version + historyHash
    const navSet = vi.mocked(setCached).mock.calls.find(
      ([ns]) => ns === "query-nav",
    )!;
    expect(navSet).toBeTruthy();
    const [, navInput, navVal] = navSet;
    const expectedHash = hashOf(["bookA", "bookB"]);
    expect(navInput).toBe(
      `Q1\x00${expectedHash}\x00${SEEDED_NAV_VERSION}\x00${histHashOf()}`,
    );
    expect(navVal).toEqual({ conceptRelPaths: ["concepts/bookA/courage.md"] });

    // answer persisted with question + accessHash + sorted selected paths + answer version + historyHash
    const ansSet = vi.mocked(setCached).mock.calls.find(
      ([ns]) => ns === "query-answer",
    )!;
    const [, ansInput, ansVal] = ansSet;
    expect(ansInput).toBe(
      `Q1\x00${expectedHash}\x00concepts/bookA/courage.md\x00${SEEDED_ANSWER_VERSION}\x00${histHashOf()}`,
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

  it("nav: uses DB template content + version in prompt and cache key", async () => {
    const CUSTOM_NAV = `CUSTOM NAV HEADER
{{listing}}
Q: {{question}}`;
    const NAV_VERSION = 7;
    vi.mocked(db.promptTemplate.findUnique).mockImplementation((async ({
      where,
    }: {
      where: { type: string };
    }) => {
      if (where.type === "shelf_nav") {
        return { content: CUSTOM_NAV, version: NAV_VERSION };
      }
      return { content: ANSWER_DEFAULT_CONTENT, version: SEEDED_ANSWER_VERSION };
    }) as never);
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("CUSTOM NAV HEADER")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "a" } as never;
    });

    await answerShelfQuestion({
      question: "Q",
      accessibleBookIds: ["bookA", "bookB"],
    });

    // The nav prompt handed to completeJson is the substituted DB content.
    const navCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("CUSTOM NAV HEADER"),
    )!;
    expect(navCall).toBeTruthy();
    // {{listing}} + {{question}} substituted (no literal placeholders remain).
    expect(navCall[0].prompt).not.toContain("{{listing}}");
    expect(navCall[0].prompt).not.toContain("{{question}}");
    expect(navCall[0].prompt).toContain("Q: Q");
    expect(navCall[0].prompt).toContain("concepts/bookA/courage.md");

    // nav cache key carries the DB nav version (3rd \x00-separated segment),
    // not the seeded default. Key shape: question \x00 hash \x00 version \x00 histHash.
    const navGetCall = vi.mocked(getCached).mock.calls.find(
      ([ns]) => ns === "query-nav",
    )!;
    const navInput = navGetCall[1] as string;
    const navParts = navInput.split("\x00");
    expect(navParts[2]).toBe(String(NAV_VERSION));
    expect(navParts[2]).not.toBe(String(SEEDED_NAV_VERSION));
  });

  it("answer: uses DB template content + version in prompt and cache key", async () => {
    const CUSTOM_ANSWER = `CUSTOM ANSWER
Q: {{question}}
Excerpts:
{{concept_excerpts}}`;
    const ANSWER_VERSION = 9;
    vi.mocked(db.promptTemplate.findUnique).mockImplementation((async ({
      where,
    }: {
      where: { type: string };
    }) => {
      if (where.type === "shelf_nav") {
        return { content: NAV_DEFAULT_CONTENT, version: SEEDED_NAV_VERSION };
      }
      return { content: CUSTOM_ANSWER, version: ANSWER_VERSION };
    }) as never);
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "grounded" } as never;
    });

    const result = await answerShelfQuestion({
      question: "What is courage?",
      accessibleBookIds: ["bookA", "bookB"],
    });

    // The answer prompt is the substituted DB content.
    const answerCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("CUSTOM ANSWER"),
    )!;
    expect(answerCall).toBeTruthy();
    expect(answerCall[0].prompt).not.toContain("{{concept_excerpts}}");
    expect(answerCall[0].prompt).not.toContain("{{question}}");
    expect(answerCall[0].prompt).toContain("Q: What is courage?");
    expect(answerCall[0].prompt).toContain("Courage");

    // answer cache key carries the DB answer version (4th segment).
    // Key shape: question \x00 hash \x00 selected \x00 version \x00 histHash.
    const ansGetCall = vi.mocked(getCached).mock.calls.find(
      ([ns]) => ns === "query-answer",
    )!;
    const ansInput = ansGetCall[1] as string;
    const ansParts = ansInput.split("\x00");
    expect(ansParts[3]).toBe(String(ANSWER_VERSION));

    // promptVersion reflects the answer template version.
    expect(result.promptVersion).toBe(ANSWER_VERSION);
  });

  it("fallback: findUnique null for both templates → uses inline defaults, no crash", async () => {
    vi.mocked(db.promptTemplate.findUnique).mockResolvedValue(null);
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "fb" } as never;
    });

    const result = await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA", "bookB"],
    });

    // Nav prompt = inline-derived default (contains the seeded nav header).
    const navCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("Available concepts"),
    )!;
    expect(navCall[0].prompt).toContain("Return ONLY valid JSON");

    // ponytail: fallback versions now mirror the seeded defaults after the
    // {{library_manifest}} bump — nav=2, answer=5.
    const navInput = vi.mocked(getCached).mock.calls.find(
      ([ns]) => ns === "query-nav",
    )![1] as string;
    const ansInput = vi.mocked(getCached).mock.calls.find(
      ([ns]) => ns === "query-answer",
    )![1] as string;
    expect(navInput.split("\x00")[2]).toBe(String(FALLBACK_NAV_VERSION));
    expect(ansInput.split("\x00")[3]).toBe(String(FALLBACK_ANSWER_VERSION));

    expect(result.promptVersion).toBe(FALLBACK_ANSWER_VERSION);
  });

  it("each cache key uses its OWN template version (nav ≠ answer is possible)", async () => {
    // Bump nav to v11, leave answer at seeded — each key must carry its own.
    const NAV_VERSION = 11;
    vi.mocked(db.promptTemplate.findUnique).mockImplementation((async ({
      where,
    }: {
      where: { type: string };
    }) => {
      if (where.type === "shelf_nav") {
        return { content: NAV_DEFAULT_CONTENT, version: NAV_VERSION };
      }
      return { content: ANSWER_DEFAULT_CONTENT, version: SEEDED_ANSWER_VERSION };
    }) as never);
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "x" } as never;
    });

    await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA", "bookB"],
    });

    const navInput = vi.mocked(getCached).mock.calls.find(
      ([ns]) => ns === "query-nav",
    )![1] as string;
    const ansInput = vi.mocked(getCached).mock.calls.find(
      ([ns]) => ns === "query-answer",
    )![1] as string;

    expect(navInput.split("\x00")[2]).toBe(String(NAV_VERSION));
    expect(ansInput.split("\x00")[3]).toBe(String(SEEDED_ANSWER_VERSION));
    // Explicitly different versions, each in its own key.
    expect(navInput).not.toBe(ansInput);
  });
  it("chapter maps: cited book's ToC injected into answer prompt as #ch:<bookId>:<basename> links", async () => {
    // ponytail: single findMany fetches id+title+tocJson together (Step 3b),
    // feeding both chapter maps and the book index + citations.
    const TOC = JSON.stringify([
      { label: "Chapter One", href: "ch1.xhtml" },
      { label: "Chapter Two", href: "ch2.xhtml" },
    ]);
    vi.mocked(db.epubFile.findMany).mockResolvedValue([
      { id: "bookA", title: "Book A", tocJson: TOC },
    ] as never);
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "a" } as never;
    });

    await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA", "bookB"],
    });

    const answerCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("Concept excerpts"),
    )!;
    expect(answerCall[0].prompt).toContain("[Chapter One](#ch:bookA:ch1.xhtml)");
    expect(answerCall[0].prompt).toContain("[Chapter Two](#ch:bookA:ch2.xhtml)");
    // citations array still produced (C2 consumes bookIds)
    const result = await answerShelfQuestion({
      question: "q2",
      accessibleBookIds: ["bookA"],
    });
    expect(result.citations.map((c) => c.bookId)).toEqual(["bookA"]);
  });

  it("chapter maps: cited book with no tocJson → '(no chapter map available)' block, no crash", async () => {
    vi.mocked(db.epubFile.findMany).mockResolvedValue([
      { id: "bookA", title: "Book A", tocJson: null },
    ] as never);
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "a" } as never;
    });

    await answerShelfQuestion({
      question: "q",
      accessibleBookIds: ["bookA"],
    });

    const answerCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("Concept excerpts"),
    )!;
    expect(answerCall[0].prompt).toContain(
      "(no chapter map available for this book)",
    );
    expect(answerCall[0].prompt).not.toContain("#ch:bookA:");
  });

  it("history: a follow-up with history produces a DIFFERENT cache key than the same question without", async () => {
    // ponytail: the bug — first-turn cache entries must not be served to a
    // follow-up that asks the same literal question with different context,
    // and different conversations must not collide on the same question.
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "a" } as never;
    });
    const history = [
      { role: "user" as const, content: "tell me about startups" },
      { role: "assistant" as const, content: "startups are..." },
    ];

    await answerShelfQuestion({
      question: "what else?",
      accessibleBookIds: ["bookA", "bookB"],
    });
    await answerShelfQuestion({
      question: "what else?",
      accessibleBookIds: ["bookA", "bookB"],
      history,
    });

    const navCalls = vi.mocked(getCached).mock.calls.filter(
      ([ns]) => ns === "query-nav",
    );
    const ansCalls = vi.mocked(getCached).mock.calls.filter(
      ([ns]) => ns === "query-answer",
    );
    expect(navCalls).toHaveLength(2);
    expect(ansCalls).toHaveLength(2);
    const [navNoHist, navWithHist] = navCalls.map((c) => c[1] as string);
    const [ansNoHist, ansWithHist] = ansCalls.map((c) => c[1] as string);

    // Different histories → different keys (history hash is the last segment).
    expect(navNoHist).not.toBe(navWithHist);
    expect(ansNoHist).not.toBe(ansWithHist);
    // The history hash segment is exactly histHashOf(history) for the follow-up,
    // and histHashOf() (empty history) for the first turn.
    expect(navWithHist.endsWith(`\x00${histHashOf(history)}`)).toBe(true);
    expect(navNoHist.endsWith(`\x00${histHashOf()}`)).toBe(true);
    expect(ansWithHist.endsWith(`\x00${histHashOf(history)}`)).toBe(true);
    expect(ansNoHist.endsWith(`\x00${histHashOf()}`)).toBe(true);
  });

  it("history: substitutes {{conversation}} into nav AND answer prompts; empty history → no conversation block", async () => {
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "a" } as never;
    });
    const history = [
      { role: "user" as const, content: "tell me about startups" },
      { role: "assistant" as const, content: "startups are..." },
    ];

    // With history: both prompts carry the framed conversation block.
    await answerShelfQuestion({
      question: "deep links for that?",
      accessibleBookIds: ["bookA"],
      history,
    });
    let navCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("Available concepts"),
    )!;
    let ansCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("Concept excerpts"),
    )!;
    expect(navCall[0].prompt).toContain("Recent conversation for context");
    expect(navCall[0].prompt).toContain("User: tell me about startups");
    expect(navCall[0].prompt).toContain("Assistant: startups are...");
    expect(ansCall[0].prompt).toContain("Recent conversation for context");
    expect(ansCall[0].prompt).toContain("User: tell me about startups");

    // No history: the conversation block is absent (substituted to "").
    vi.clearAllMocks();
    vi.mocked(getCached).mockResolvedValue(null);
    vi.mocked(setCached).mockResolvedValue(undefined);
    setupReadWiki();
    setupDbTitles({ bookA: "Book A" });
    vi.mocked(db.promptTemplate.findUnique).mockImplementation((async ({
      where,
    }: {
      where: { type: string };
    }) => {
      if (where.type === "shelf_nav") {
        return { content: NAV_DEFAULT_CONTENT, version: SEEDED_NAV_VERSION };
      }
      if (where.type === "shelf_answer") {
        return { content: ANSWER_DEFAULT_CONTENT, version: SEEDED_ANSWER_VERSION };
      }
      return null;
    }) as never);
    vi.mocked(completeJson).mockImplementation(async (a) => {
      if (a.prompt.includes("Available concepts")) {
        return { conceptRelPaths: ["concepts/bookA/courage.md"] } as never;
      }
      return { answer: "a" } as never;
    });

    await answerShelfQuestion({
      question: "what is courage?",
      accessibleBookIds: ["bookA"],
    });
    navCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("Available concepts"),
    )!;
    ansCall = vi.mocked(completeJson).mock.calls.find((c) =>
      c[0].prompt.includes("Concept excerpts"),
    )!;
    expect(navCall[0].prompt).not.toContain("Recent conversation for context");
    expect(ansCall[0].prompt).not.toContain("Recent conversation for context");
    // No literal placeholder leakage.
    expect(navCall[0].prompt).not.toContain("{{conversation}}");
    expect(ansCall[0].prompt).not.toContain("{{conversation}}");
  });
});

// ponytail: mirror the production access-hash so tests assert the exact key
// contract without importing crypto internals from query.ts.
import crypto from "node:crypto";
function hashOf(ids: string[]): string {
  return crypto.createHash("sha256").update([...ids].sort().join(",")).digest("hex");
}
// ponytail: mirror the production history-hash (sha256(JSON.stringify(history)).slice(0,16))
// so cache-key assertions reflect the live contract.
function histHashOf(history?: { role: "user" | "assistant"; content: string }[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(history ?? []))
    .digest("hex")
    .slice(0, 16);
}
