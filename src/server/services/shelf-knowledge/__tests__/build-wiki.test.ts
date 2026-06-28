import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: { epubFile: { findMany: vi.fn() } },
}));

vi.mock("../extract", () => ({ extractBookConcepts: vi.fn() }));
vi.mock("../cluster", () => ({ clusterByTopic: vi.fn() }));
vi.mock("../synthesize", () => ({ synthesizeClusterTheme: vi.fn() }));
vi.mock("../render", () => ({
  conceptToMarkdown: vi.fn(),
  themeToMarkdown: vi.fn(),
  buildIndex: vi.fn(),
}));
vi.mock("../wiki-storage", () => ({
  writeWikiFile: vi.fn(),
  listWikiFiles: vi.fn(),
  removeWikiFile: vi.fn(),
}));
vi.mock("../config", () => ({ getShelfLlmConfig: vi.fn() }));
vi.mock("../../settings", () => ({ setSetting: vi.fn() }));

import { db } from "@/server/db";
import { extractBookConcepts } from "../extract";
import { clusterByTopic } from "../cluster";
import { synthesizeClusterTheme } from "../synthesize";
import { conceptToMarkdown, themeToMarkdown, buildIndex } from "../render";
import {
  writeWikiFile,
  listWikiFiles,
  removeWikiFile,
} from "../wiki-storage";
import { getShelfLlmConfig } from "../config";
import { setSetting } from "../../settings";
import { preview, build } from "../build-wiki";
import type { OkfConcept, OkfClusterTheme } from "../types";

function mkConcept(
  title: string,
  sourceBookId: string,
  topic = "heroism",
): OkfConcept {
  return {
    conceptType: "theme",
    title,
    bodyFields: { description: `${title} desc` },
    relatedConceptNames: [],
    sourceBookId,
    topic,
    form: "narrative",
  };
}

// ponytail: deterministic relPath from concept — mirrors render.conceptRelPath
// shape so the knownConceptRelPaths set is predictable in assertions.
function conceptRel(c: OkfConcept): string {
  return `concepts/${c.sourceBookId}/${c.title}.md`;
}

describe("preview() — pure estimate, NO LLM/spend", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns correct counts from txtTokens and reports model; makes no extract/render/LLM calls", async () => {
    // 3 books; total tokens = 1500 + 3000 + 4500 = 9000
    // ponytail: partial findMany fixtures cast as never — the mock ignores the
    // real Prisma row shape; runtime only reads the fields listed.
    vi.mocked(db.epubFile.findMany).mockResolvedValue([
      { id: "b1", title: "B1", txtTokens: 1500, bookMetadata: { isNarrative: true } },
      { id: "b2", title: "B2", txtTokens: 3000, bookMetadata: { isNarrative: false } },
      { id: "b3", title: "B3", txtTokens: 4500, bookMetadata: null },
    ] as never);
    vi.mocked(getShelfLlmConfig).mockResolvedValue({
      apiKey: "key",
      model: "qwen/qwen3-235b-a22b",
    });

    const result = await preview();

    expect(result).toEqual({
      bookCount: 3,
      totalTxtTokens: 9000,
      extractionCalls: 3, // one whole-book call per book
      synthesisCalls: Math.min(3, Math.ceil(3 / 3)), // = 1
      model: "qwen/qwen3-235b-a22b",
    });

    // Cost gate: NO LLM / extract / render / synthesis / wiki writes happen.
    expect(extractBookConcepts).not.toHaveBeenCalled();
    expect(synthesizeClusterTheme).not.toHaveBeenCalled();
    expect(writeWikiFile).not.toHaveBeenCalled();
    expect(conceptToMarkdown).not.toHaveBeenCalled();
    expect(themeToMarkdown).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("treats null txtTokens as 0", async () => {
    vi.mocked(db.epubFile.findMany).mockResolvedValue([
      { id: "b1", title: "B1", txtTokens: null, bookMetadata: null },
    ] as never);
    vi.mocked(getShelfLlmConfig).mockResolvedValue({
      apiKey: "k",
      model: "m",
    });

    const result = await preview();
    expect(result.totalTxtTokens).toBe(0);
    expect(result.extractionCalls).toBe(1); // one call per book
    expect(result.synthesisCalls).toBe(Math.min(1, Math.ceil(1 / 3))); // min(1,1)=1
  });
});

describe("build() — full pipeline with all sub-modules mocked", () => {
  const conceptA1 = mkConcept("Courage", "bookA");
  const conceptA2 = mkConcept("Sacrifice", "bookA");
  const conceptB1 = mkConcept("Valor", "bookB");
  const conceptC1 = mkConcept("Heat", "bookC", "cooking");

  const books = [
    {
      id: "bookA",
      title: "Book A",
      txtPath: "/a.txt",
      bookMetadata: { isNarrative: true },
    },
    {
      id: "bookB",
      title: "Book B",
      txtPath: "/b.txt",
      bookMetadata: { isNarrative: true },
    },
    {
      id: "bookC",
      title: "Book C",
      txtPath: "/c.txt",
      bookMetadata: null,
    },
  ];

  function setupHappy() {
    vi.mocked(db.epubFile.findMany).mockResolvedValue(books as never);
    vi.mocked(extractBookConcepts).mockImplementation(async (book) => {
      if (book.id === "bookA")
        return { concepts: [conceptA1, conceptA2], topic: "heroism", form: "narrative" };
      if (book.id === "bookB")
        return { concepts: [conceptB1], topic: "heroism", form: "narrative" };
      return { concepts: [conceptC1], topic: "cooking", form: "unknown" };
    });
    // ponytail: clusterByTopic mocked — real one would group A+B on "heroism"
    // and drop C (single-book cluster). We force the same to decouple from extract.
    vi.mocked(clusterByTopic).mockReturnValue([
      { topic: "heroism", bookIds: ["bookA", "bookB"] },
    ]);
    vi.mocked(synthesizeClusterTheme).mockResolvedValue({
      topic: "heroism",
      title: "Shared Heroism",
      summary: "Both valorize courage.",
      relatedConceptIds: [conceptRel(conceptA1), conceptRel(conceptB1)],
    });
    vi.mocked(conceptToMarkdown).mockImplementation((c) => ({
      relPath: conceptRel(c),
      body: `body-${c.title}`,
    }));
    vi.mocked(themeToMarkdown).mockImplementation((t) => ({
      relPath: `themes/${t.topic}.md`,
      body: `theme-${t.title}`,
    }));
    vi.mocked(buildIndex).mockReturnValue({
      relPath: "index.md",
      body: "# Shelf Wiki",
    });
    vi.mocked(writeWikiFile).mockImplementation(async (rel) => rel);
    vi.mocked(listWikiFiles).mockImplementation(async (prefix) =>
      prefix === "concepts"
        ? ["concepts/old.md", "concepts/bookA/stale.md"]
        : prefix === "themes"
          ? ["themes/old.md"]
          : [],
    );
    vi.mocked(removeWikiFile).mockResolvedValue(undefined);
    vi.mocked(setSetting).mockResolvedValue(undefined);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupHappy();
  });

  it("walks extract → cluster → synthesize → render; sets status building→done; returns counts", async () => {
    const result = await build();

    // counts: 4 concepts (a1,a2,b1,c1), 1 theme, files = 4 + 1 + 1 (index)
    expect(result).toEqual({ concepts: 4, themes: 1, files: 6 });

    // extract once per book
    expect(extractBookConcepts).toHaveBeenCalledTimes(3);
    for (const b of books) {
      expect(
        vi.mocked(extractBookConcepts).mock.calls.some((c) => c[0].id === b.id),
      ).toBe(true);
    }

    // clusterByTopic fed the per-book topic tags
    expect(clusterByTopic).toHaveBeenCalledTimes(1);
    const tags = vi.mocked(clusterByTopic).mock.calls[0][0];
    expect(tags).toEqual([
      { bookId: "bookA", topic: "heroism" },
      { bookId: "bookB", topic: "heroism" },
      { bookId: "bookC", topic: "cooking" },
    ]);

    // synthesize once for the heroism cluster, scoped to bookA+bookB concepts
    expect(synthesizeClusterTheme).toHaveBeenCalledTimes(1);
    const synthArgs = vi.mocked(synthesizeClusterTheme).mock.calls[0][0];
    expect(synthArgs.topic).toBe("heroism");
    expect(synthArgs.bookConcepts.map((b) => b.bookId)).toEqual([
      "bookA",
      "bookB",
    ]);
    expect(synthArgs.bookConcepts[0].concepts).toEqual([conceptA1, conceptA2]);
    expect(synthArgs.bookConcepts[1].concepts).toEqual([conceptB1]);

    // status transitions: building first, done last with counts
    expect(setSetting).toHaveBeenCalledWith(
      "shelfWikiStatus",
      expect.stringContaining('"building"'),
    );
    const doneCall = vi.mocked(setSetting).mock.calls.find((c) =>
      (c[1] as string).includes('"done"'),
    );
    expect(doneCall).toBeTruthy();
    const doneState = JSON.parse(doneCall![1] as string);
    expect(doneState.state).toBe("done");
    expect(doneState.counts).toEqual({ concepts: 4, themes: 1, files: 6 });
  });

  it("clears concepts/ and themes/ but NEVER touches .cache/", async () => {
    await build();

    // listed only concepts + themes prefixes
    const listed = vi.mocked(listWikiFiles).mock.calls.map((c) => c[0] as string);
    expect(listed).toEqual(expect.arrayContaining(["concepts", "themes"]));
    expect(listed).not.toContain("");
    expect(listed.every((p) => !p.includes("cache"))).toBe(true);

    // removeWikiFile never receives a .cache path
    for (const [rel] of vi.mocked(removeWikiFile).mock.calls) {
      expect(rel).not.toMatch(/\.cache/);
    }
    // the old files returned by the mock WERE removed
    expect(
      vi.mocked(removeWikiFile).mock.calls.some(
        (c) => c[0] === "concepts/old.md",
      ),
    ).toBe(true);
    expect(
      vi.mocked(removeWikiFile).mock.calls.some(
        (c) => c[0] === "themes/old.md",
      ),
    ).toBe(true);
  });

  it("renders every concept + theme + index; theme render gets the union concept-relPath set", async () => {
    await build();

    // 4 concepts + 1 theme + 1 index written
    expect(writeWikiFile).toHaveBeenCalledTimes(6);
    expect(conceptToMarkdown).toHaveBeenCalledTimes(4);
    expect(themeToMarkdown).toHaveBeenCalledTimes(1);
    expect(buildIndex).toHaveBeenCalledTimes(1);

    // index written under index.md
    expect(writeWikiFile).toHaveBeenCalledWith("index.md", "# Shelf Wiki");

    // themeToMarkdown received a set containing ALL concept relPaths
    const themeArgs = vi.mocked(themeToMarkdown).mock.calls[0];
    const knownSet: Set<string> = themeArgs[1];
    expect(knownSet).toBeInstanceOf(Set);
    const expected = new Set([
      conceptRel(conceptA1),
      conceptRel(conceptA2),
      conceptRel(conceptB1),
      conceptRel(conceptC1),
    ]);
    expect(knownSet).toEqual(expected);
  });

  it("onProgress is invoked across stages including done", async () => {
    const onProgress = vi.fn();
    await build({ onProgress });

    const stages = onProgress.mock.calls.map((c) => c[0]);
    expect(stages).toContain("start");
    expect(stages).toContain("done");
    // per-book extract progress fired
    expect(stages.filter((s) => s === "extract").length).toBe(3);
  });

  it("on a thrown error: sets status error and rethrows", async () => {
    vi.mocked(extractBookConcepts).mockRejectedValue(new Error("boom"));
    // ponytail: cluster mock still returns something so we reach the failure
    // inside the extract loop; extract throws before cluster is reached.
    vi.mocked(clusterByTopic).mockReturnValue([]);

    await expect(build()).rejects.toThrow("boom");

    const errCall = vi.mocked(setSetting).mock.calls.find((c) =>
      (c[1] as string).includes('"error"'),
    );
    expect(errCall).toBeTruthy();
    const errState = JSON.parse(errCall![1] as string);
    expect(errState.state).toBe("error");
    expect(errState.message).toBe("boom");

    // no done status was written
    expect(
      vi.mocked(setSetting).mock.calls.some((c) =>
        (c[1] as string).includes('"done"'),
      ),
    ).toBe(false);
    // nothing rendered after the failure
    expect(writeWikiFile).not.toHaveBeenCalled();
  });

  it("concurrent calls share ONE build (in-process mutex): pipeline runs once, both callers get a result", async () => {
    // ponytail: force overlap by blocking extractBookConcepts on a deferred
    // promise until both callers have entered build(). The second caller must
    // hit the buildInFlight guard and join the in-flight build.
    let resolveExtract!: () => void;
    let extractEntered = 0;
    const bothEntered = new Promise<void>((resolve) => {
      resolveExtract = resolve;
    });
    // The first extract call resolves the gate; subsequent extract calls run
    // normally. We just need to hold the FIRST call until we kick it from the
    // test (which we do after firing both build()s).
    vi.mocked(extractBookConcepts).mockImplementation(async (book) => {
      extractEntered++;
      if (extractEntered === 1) await bothEntered;
      if (book.id === "bookA")
        return { concepts: [conceptA1, conceptA2], topic: "heroism", form: "narrative" };
      if (book.id === "bookB")
        return { concepts: [conceptB1], topic: "heroism", form: "narrative" };
      return { concepts: [conceptC1], topic: "cooking", form: "unknown" };
    });

    // Fire both without awaiting — they race into build().
    const p1 = build();
    const p2 = build();
    // Let the event loop tick so caller 1 enters the IIFE and sets the mutex,
    // and caller 2 observes it.
    await Promise.resolve();
    await Promise.resolve();
    // Release the held extract so the single shared build can finish.
    resolveExtract();

    const [r1, r2] = await Promise.all([p1, p2]);

    // Both callers got a valid BuildResult (the shared one).
    expect(r1).toEqual({ concepts: 4, themes: 1, files: 6 });
    expect(r2).toEqual(r1);

    // The pipeline ran EXACTLY ONCE — no interleaved duplicate writes.
    expect(extractBookConcepts).toHaveBeenCalledTimes(3);
    expect(clusterByTopic).toHaveBeenCalledTimes(1);
    expect(synthesizeClusterTheme).toHaveBeenCalledTimes(1);
    expect(writeWikiFile).toHaveBeenCalledTimes(6);
    // status 'building' set exactly once (not twice from two overlapping builds)
    const buildingCalls = vi.mocked(setSetting).mock.calls.filter((c) =>
      (c[1] as string).includes('"building"'),
    );
    expect(buildingCalls.length).toBe(1);
  });
});
