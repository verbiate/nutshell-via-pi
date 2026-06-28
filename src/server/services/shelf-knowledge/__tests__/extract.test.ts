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
  isChunkResult,
  NARRATIVE_PROMPT,
  NONFICTION_PROMPT,
  GENERIC_PROMPT,
  EXTRACT_CONCURRENCY,
} from "../extract";

// ponytail: build text that chunkText({softLimit:6000, hardLimit:8000}) splits
// into exactly n chunks — each block is one ~6605-char sentence (over softLimit,
// under hardLimit), so chunkText emits one chunk per block. Verified empirically.
function chunkableText(n: number): string {
  const blocks: string[] = [];
  for (let i = 0; i < n; i++) {
    blocks.push(`word${i} `.repeat(1100) + `end${i}.`);
  }
  return blocks.join("\n\n");
}

const baseBook = {
  id: "book-1",
  title: "Test Book",
  txtPath: "data/uploads/book-1.txt",
};

describe("extractBookConcepts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadBookText).mockResolvedValue(chunkableText(1));
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

  it("narrative book (isNarrative: true) → uses the narrative prompt", async () => {
    const result = await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: true },
    });

    expect(completeJson).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(completeJson).mock.calls[0][0].prompt;
    expect(prompt.startsWith(NARRATIVE_PROMPT)).toBe(true);
    expect(prompt).toContain("character");
    expect(result.form).toBe("narrative");
  });

  it("nonfiction book (isNarrative: false) → uses the nonfiction prompt", async () => {
    vi.mocked(completeJson).mockResolvedValue({
      topic: "epistemology",
      form: "nonfiction",
      concepts: [
        {
          conceptType: "argument",
          title: "Foundationalism",
          bodyFields: { description: "x" },
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
    expect(prompt).toContain("argument");
    expect(result.form).toBe("nonfiction");
  });

  it("unknown metadata (isNarrative: null) → generic prompt + form backfilled from model output", async () => {
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
    expect(result.form).toBe("narrative"); // backfilled from the model's inference
  });

  it("cache hit on a chunk → completeJson NOT called for that chunk", async () => {
    vi.mocked(loadBookText).mockResolvedValue(chunkableText(2));
    const cachedResult = {
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
    // chunk 1 misses, chunk 2 hits cache.
    vi.mocked(getCached)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(cachedResult);

    await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: true },
    });

    expect(completeJson).toHaveBeenCalledTimes(1); // only the miss
    expect(setCached).toHaveBeenCalledTimes(1); // only the miss is written
  });

  it("chunk-and-merge: two chunks, same title-slug → one concept with merged fields", async () => {
    vi.mocked(loadBookText).mockResolvedValue(chunkableText(2));
    vi.mocked(completeJson)
      .mockResolvedValueOnce({
        topic: "merge-topic",
        form: "narrative" as const,
        concepts: [
          {
            conceptType: "character",
            title: "Hero", // same title → same slug
            bodyFields: { role: "protagonist" },
            relatedConceptNames: ["Villain"],
          },
        ],
      })
      .mockResolvedValueOnce({
        topic: "merge-topic",
        form: "narrative" as const,
        concepts: [
          {
            conceptType: "character",
            title: "Hero", // collision
            bodyFields: { arc: "growth" }, // different field
            relatedConceptNames: ["Mentor"], // different relation
          },
        ],
      });

    const result = await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: true },
    });

    expect(result.concepts).toHaveLength(1);
    const merged = result.concepts[0];
    expect(merged.title).toBe("Hero");
    expect(merged.bodyFields).toEqual({ role: "protagonist", arc: "growth" });
    expect([...merged.relatedConceptNames].sort()).toEqual(["Mentor", "Villain"]);
  });

  it("stamps sourceBookId + topic authoritatively (overwrites hallucinated values)", async () => {
    vi.mocked(completeJson).mockResolvedValue({
      topic: "real-topic", // chunk-level topic → the voted book topic
      form: "narrative",
      concepts: [
        {
          conceptType: "character",
          title: "Hero",
          bodyFields: { role: "x" },
          relatedConceptNames: [],
          // ponytail: hallucinated values the code MUST overwrite
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
    expect(result.concepts[0].topic).toBe("real-topic"); // voted from chunk topic
    expect(result.concepts[0].form).toBe("narrative"); // from metadata, not hallucinated
  });

  it("runs at most EXTRACT_CONCURRENCY chunks concurrently (bounded pool)", async () => {
    // ponytail: 20 chunks > concurrency(6), so all 6 workers stay busy at once.
    // A max-in-flight counter + artificial delay proves (a) the bound holds and
    // (b) we're actually concurrent, not just sequential under a loop.
    vi.mocked(loadBookText).mockResolvedValue(chunkableText(20));
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(completeJson).mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10)); // overlap window
      inFlight--;
      return {
        topic: "concurrency-test",
        form: "narrative" as const,
        concepts: [],
      };
    });

    const result = await extractBookConcepts({
      ...baseBook,
      bookMetadata: { isNarrative: true },
    });

    expect(maxInFlight).toBeLessThanOrEqual(EXTRACT_CONCURRENCY); // bound holds
    expect(maxInFlight).toBeGreaterThan(1); // actually concurrent, not sequential
    expect(completeJson).toHaveBeenCalledTimes(20); // every chunk processed
    // ponytail: results land in original order → merge/dedupe unaffected.
    expect(result.topic).toBe("concurrency-test");
  });
});

// ponytail: the validators are what completeJson's retry loop actually calls
// against real-LLM output (Task 11). Cheap unit coverage so the shape contract
// isn't untested — and so the M3 bodyFields-values check has a failing case.
describe("isChunkResult / isRawConcept", () => {
  const validConcept = {
    conceptType: "character",
    title: "Hero",
    bodyFields: { role: "protagonist" },
    relatedConceptNames: ["Villain"],
  };

  it("accepts a valid shape including empty concepts: []", () => {
    expect(isChunkResult({ topic: "t", concepts: [] })).toBe(true);
    expect(isRawConcept(validConcept)).toBe(true);
  });

  it("rejects {concepts: 'x'} (concepts must be an array)", () => {
    expect(isChunkResult({ topic: "t", concepts: "x" })).toBe(false);
  });

  it("rejects a concept with a non-string bodyFields value (nested object)", () => {
    const bad = { ...validConcept, bodyFields: { role: { deep: "no" } } };
    expect(isRawConcept(bad)).toBe(false);
    expect(isChunkResult({ topic: "t", concepts: [bad] })).toBe(false);
  });

  it("rejects a concept missing conceptType", () => {
    const noType: Record<string, unknown> = { ...validConcept };
    delete noType.conceptType;
    expect(isRawConcept(noType)).toBe(false);
  });

  it("rejects when topic is missing", () => {
    expect(isChunkResult({ concepts: [] })).toBe(false);
  });
});
