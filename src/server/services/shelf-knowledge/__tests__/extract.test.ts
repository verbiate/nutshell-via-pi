import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/prompt-builder", () => ({
  loadBookText: vi.fn(),
}));

vi.mock("../cache", () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}));

vi.mock("../llm-json", () => ({
  completeJson: vi.fn(),
}));

import { loadBookText } from "@/server/services/prompt-builder";
import { getCached, setCached } from "../cache";
import { completeJson } from "../llm-json";
import {
  extractBookConcepts,
  isRawConcept,
  isBookResult,
  NARRATIVE_PROMPT,
  NONFICTION_PROMPT,
  GENERIC_PROMPT,
} from "../extract";

// ponytail: whole-book design — no chunking, so any non-trivial text works.
const FULL_BOOK_TEXT =
  "Call me Ishmael. Some years ago—never mind how long precisely—...";

const baseBook = {
  id: "book-1",
  title: "Test Book",
  txtPath: "data/uploads/book-1.txt",
};

describe("extractBookConcepts (whole-book, single LLM call)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadBookText).mockResolvedValue(FULL_BOOK_TEXT);
    vi.mocked(getCached).mockResolvedValue(null);
    vi.mocked(setCached).mockResolvedValue(undefined);
    vi.mocked(completeJson).mockResolvedValue({
      topic: "heroism",
      form: "narrative",
      concepts: [
        {
          conceptType: "character",
          title: "Hero",
          bodyFields: { role: "protagonist" },
          relatedConceptNames: ["Villain"],
        },
      ],
    });
  });

  it("narrative book (isNarrative: true) → narrative template + whole-book framing", async () => {
    const result = await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: true },
    });

    // ponytail: the headline assertion of the new design — exactly ONE call.
    expect(completeJson).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(completeJson).mock.calls[0][0].prompt;
    expect(prompt.startsWith(NARRATIVE_PROMPT)).toBe(true);
    expect(prompt).toContain("ENTIRE BOOK");
    expect(prompt).not.toContain("PASSAGE");
    expect(prompt.endsWith(FULL_BOOK_TEXT)).toBe(true);
    expect(result.form).toBe("narrative");
  });

  it("nonfiction book (isNarrative: false) → nonfiction template + whole-book framing", async () => {
    vi.mocked(completeJson).mockResolvedValue({
      topic: "epistemology",
      form: "nonfiction",
      concepts: [
        {
          conceptType: "argument",
          title: "Foundationalism",
          bodyFields: { claim: "x" },
          relatedConceptNames: [],
        },
      ],
    });

    const result = await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: false },
    });

    expect(completeJson).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(completeJson).mock.calls[0][0].prompt;
    expect(prompt.startsWith(NONFICTION_PROMPT)).toBe(true);
    expect(prompt).toContain("ENTIRE BOOK");
    expect(prompt).not.toContain("PASSAGE");
    expect(result.form).toBe("nonfiction");
  });

  it("unknown metadata (isNarrative: null) → generic template + form backfilled from model output", async () => {
    vi.mocked(completeJson).mockResolvedValue({
      topic: "travel",
      form: "narrative",
      concepts: [
        {
          conceptType: "setting",
          title: "The Road",
          bodyFields: { description: "long" },
          relatedConceptNames: [],
        },
      ],
    });

    const result = await extractBookConcepts({
      ...baseBook,
      bookMetadata: null,
    });

    expect(completeJson).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(completeJson).mock.calls[0][0].prompt;
    expect(prompt.startsWith(GENERIC_PROMPT)).toBe(true);
    expect(prompt).toContain("ENTIRE BOOK");
    expect(prompt).not.toContain("PASSAGE");
    expect(result.form).toBe("narrative"); // backfilled from model inference
  });

  it("stamps sourceBookId + topic in code (overwrites hallucinated values)", async () => {
    vi.mocked(completeJson).mockResolvedValue({
      topic: "real-topic",
      form: "narrative",
      concepts: [
        {
          conceptType: "character",
          title: "Hero",
          bodyFields: { role: "x" },
          relatedConceptNames: [],
          // ponytail: hallucinated values the code MUST overwrite.
          sourceBookId: "HALLUCINATED-BOOK",
          topic: "HALLUCINATED-TOPIC",
          form: "nonfiction",
        },
      ],
    });

    const result = await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: true },
    });

    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0].sourceBookId).toBe("book-1");
    expect(result.concepts[0].topic).toBe("real-topic");
    expect(result.concepts[0].form).toBe("narrative"); // from metadata, not hallucinated
  });

  it("cache hit (per-book key) → completeJson NOT called", async () => {
    const cached = {
      topic: "cached-topic",
      form: "narrative" as const,
      concepts: [
        {
          conceptType: "character",
          title: "Cached",
          bodyFields: { role: "x" },
          relatedConceptNames: [],
        },
      ],
    };
    vi.mocked(getCached).mockResolvedValue(cached);

    const result = await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: true },
    });

    expect(completeJson).not.toHaveBeenCalled();
    expect(setCached).not.toHaveBeenCalled();
    expect(result.topic).toBe("cached-topic");
    expect(result.concepts[0].sourceBookId).toBe("book-1"); // stamped from book
  });

  it("passes through a ~10-12 concept set unchanged (no per-chunk cap/merge)", async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      conceptType: "character",
      title: `Concept ${i}`,
      bodyFields: { role: `role ${i}` },
      relatedConceptNames: [],
    }));
    vi.mocked(completeJson).mockResolvedValue({
      topic: "big-topic",
      form: "narrative",
      concepts: many,
    });

    const result = await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: true },
    });

    expect(completeJson).toHaveBeenCalledTimes(1);
    expect(result.concepts).toHaveLength(11);
    expect(result.concepts.map((c) => c.title)).toEqual(
      many.map((c) => c.title),
    );
  });

  it("calls completeJson EXACTLY ONCE per book (headline assertion)", async () => {
    await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: true },
    });
    await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: false },
    });
    await extractBookConcepts({
      ...baseBook,
      bookMetadata: null,
    });

    // ponytail: 3 books → 3 calls total (1 each). The chunked design made 1,000s.
    expect(completeJson).toHaveBeenCalledTimes(3);
  });

  it("writes the cache once on miss (per-book key)", async () => {
    await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: true },
    });

    expect(setCached).toHaveBeenCalledTimes(1);
    const [ns, input, value] = vi.mocked(setCached).mock.calls[0];
    expect(ns).toBe("extract");
    expect(input).toContain("book-1");
    expect(value).toBeDefined();
  });
});

// ponytail: the validators are what completeJson's retry loop actually calls.
// Cheap shape-contract coverage; isBookResult replaces the old isChunkResult.
describe("isBookResult / isRawConcept", () => {
  const validConcept = {
    conceptType: "character",
    title: "Hero",
    bodyFields: { role: "protagonist" },
    relatedConceptNames: ["Villain"],
  };

  it("accepts a valid shape including empty concepts: []", () => {
    expect(isBookResult({ topic: "t", concepts: [] })).toBe(true);
    expect(isRawConcept(validConcept)).toBe(true);
  });

  it("rejects {concepts: 'x'} (concepts must be an array)", () => {
    expect(isBookResult({ topic: "t", concepts: "x" })).toBe(false);
  });

  it("rejects a concept with a non-string bodyFields value (nested object)", () => {
    const bad = { ...validConcept, bodyFields: { role: { deep: "no" } } };
    expect(isRawConcept(bad)).toBe(false);
    expect(isBookResult({ topic: "t", concepts: [bad] })).toBe(false);
  });

  it("rejects a concept missing conceptType", () => {
    const noType: Record<string, unknown> = { ...validConcept };
    delete noType.conceptType;
    expect(isRawConcept(noType)).toBe(false);
  });

  it("rejects when topic is missing", () => {
    expect(isBookResult({ concepts: [] })).toBe(false);
  });
});
