import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../cache", () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}));

vi.mock("../llm-json", () => ({
  completeJson: vi.fn(),
}));

import { getCached, setCached } from "../cache";
import { completeJson } from "../llm-json";
import { conceptRelPath } from "../render";
import type { OkfConcept } from "../types";
import { synthesizeClusterTheme, SYNTH_PROMPT_VERSION } from "../synthesize";

function makeConcept(
  opts: Partial<OkfConcept> & { title: string; sourceBookId: string },
): OkfConcept {
  return {
    conceptType: "theme",
    bodyFields: { description: "default" },
    relatedConceptNames: [],
    topic: "heroism",
    form: "narrative",
    ...opts,
  };
}

const bookAConcept = makeConcept({
  title: "The Hero's Journey",
  sourceBookId: "book-a",
  bodyFields: { description: "classic Campbell arc" },
});

const bookBConcept = makeConcept({
  title: "Reluctant Hero",
  sourceBookId: "book-b",
  bodyFields: { description: "hero resists the call" },
});

// A concept from a DIFFERENT cluster — must NOT leak into this cluster's prompt.
const outsideConcept = makeConcept({
  title: "Cooking Pasta",
  sourceBookId: "book-c",
  topic: "cooking",
  bodyFields: { description: "italian cuisine" },
});

const clusterArgs = {
  topic: "heroism",
  bookConcepts: [
    { bookId: "book-a", bookTitle: "Book A", concepts: [bookAConcept] },
    { bookId: "book-b", bookTitle: "Book B", concepts: [bookBConcept] },
  ],
};

describe("synthesizeClusterTheme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCached).mockResolvedValue(null);
    vi.mocked(setCached).mockResolvedValue(undefined);
    vi.mocked(completeJson).mockResolvedValue({
      // ponytail: hallucinated topic + invented id — production stamps topic
      // and the validator rejects the invented id (covered in the retry test).
      topic: "HALLUCINATED",
      title: "Heroes Across Books",
      summary: "Both books frame heroism as reluctant.",
      relatedConceptIds: [conceptRelPath(bookAConcept)],
    });
  });

  it("happy path: prompt scoped to cluster only; returns theme with topic stamped from cluster", async () => {
    const result = await synthesizeClusterTheme(clusterArgs);

    expect(completeJson).toHaveBeenCalledTimes(1);
    const { prompt } = vi.mocked(completeJson).mock.calls[0][0];
    // only this cluster's concepts are in the prompt
    expect(prompt).toContain("The Hero's Journey");
    expect(prompt).toContain("Reluctant Hero");
    expect(prompt).toContain("classic Campbell arc"); // bodyField summary
    // a concept from a different cluster must NOT leak in
    expect(prompt).not.toContain("Cooking Pasta");
    expect(prompt).not.toContain("italian cuisine");

    // topic stamped from the cluster, NOT trusted from the LLM
    expect(result.topic).toBe("heroism");
    expect(result.title).toBe("Heroes Across Books");
    expect(result.summary).toBe("Both books frame heroism as reluctant.");
    expect(result.relatedConceptIds).toEqual([conceptRelPath(bookAConcept)]);
  });

  it("LLM invents a relatedConceptId → validate rejects → retry returns good", async () => {
    const good = {
      title: "Shared Heroism",
      summary: "synthesis",
      relatedConceptIds: [conceptRelPath(bookAConcept)],
    };
    const bad = {
      ...good,
      relatedConceptIds: ["concepts/fake-book/invented.md"],
    };

    // Simulate completeJson's internal retry: it would try `bad`, validate
    // rejects, then retry produces `good`. The mock stands in for that loop.
    vi.mocked(completeJson).mockImplementation(async (a) => {
      // If the validate were broken (accepted the invented id), we'd get bad.
      // Correct validate → reject bad → fall through to good.
      if (a.validate(bad)) return bad;
      return good;
    });

    const result = await synthesizeClusterTheme(clusterArgs);

    // Directly prove the validate rejects the invented id (would trigger retry)
    const { validate } = vi.mocked(completeJson).mock.calls[0][0];
    expect(validate(bad)).toBe(false);
    expect(validate(good)).toBe(true);

    expect(result.relatedConceptIds).toEqual([conceptRelPath(bookAConcept)]);
    expect(result.topic).toBe("heroism");
  });

  it("cache hit → completeJson NOT called and cache is not rewritten", async () => {
    const cached = {
      topic: "heroism",
      title: "Cached Theme",
      summary: "from cache",
      relatedConceptIds: [conceptRelPath(bookAConcept)],
    };
    vi.mocked(getCached).mockResolvedValue(cached);

    const result = await synthesizeClusterTheme(clusterArgs);

    expect(result).toBe(cached);
    expect(completeJson).not.toHaveBeenCalled();
    expect(setCached).not.toHaveBeenCalled();
  });

  it("concept-id set passed to validator matches provided concepts' relPaths", async () => {
    await synthesizeClusterTheme(clusterArgs);
    const { validate } = vi.mocked(completeJson).mock.calls[0][0];

    // both cluster concepts' relPaths accepted together
    expect(
      validate({
        title: "T",
        summary: "S",
        relatedConceptIds: [
          conceptRelPath(bookAConcept),
          conceptRelPath(bookBConcept),
        ],
      }),
    ).toBe(true);

    // an id from a different cluster (valid relPath shape, not in known set) rejected
    expect(
      validate({
        title: "T",
        summary: "S",
        relatedConceptIds: [conceptRelPath(outsideConcept)],
      }),
    ).toBe(false);

    // non-string relatedConceptIds rejected (shape)
    expect(
      validate({
        title: "T",
        summary: "S",
        relatedConceptIds: [123],
      }),
    ).toBe(false);

    // missing summary rejected (shape)
    expect(
      validate({ title: "T", relatedConceptIds: [] }),
    ).toBe(false);
  });

  it("cache key: namespace 'synthesize', input folds topic + sorted bookIds + version", async () => {
    await synthesizeClusterTheme(clusterArgs);

    expect(getCached).toHaveBeenCalledTimes(1);
    const [namespace, input] = vi.mocked(getCached).mock.calls[0];
    expect(namespace).toBe("synthesize");
    // sorted bookIds (already in order) joined, separated from topic + version
    expect(input).toBe(
      `heroism\x00book-a,book-b\x00${SYNTH_PROMPT_VERSION}`,
    );

    // reversed input order must produce the SAME key (sorting is stable)
    await synthesizeClusterTheme({
      topic: "heroism",
      bookConcepts: [clusterArgs.bookConcepts[1], clusterArgs.bookConcepts[0]],
    });
    const reversedInput = vi.mocked(getCached).mock.calls[1][1];
    expect(reversedInput).toBe(input);
  });
});
