import { describe, it, expect } from "vitest";
import { clusterByTopic } from "../cluster";

describe("clusterByTopic", () => {
  it("returns [] for empty input", () => {
    expect(clusterByTopic([])).toEqual([]);
  });

  it("clusters by word-overlap: the real-LLM validation case", () => {
    // Real LLMs tag the same shelf-topic with varying surface text. These three
    // are the same theme, but exact-match would yield ZERO clusters (observed
    // in validation). "strategy"/"guide" are stopwords, so all collapse to
    // the word-set {brand, naming} → Jaccard 1.0 → one cluster.
    const out = clusterByTopic([
      { bookId: "a", topic: "Brand Naming Strategy" },
      { bookId: "b", topic: "brand naming" },
      { bookId: "c", topic: "Brand Naming Guide" },
    ]);
    expect(out).toEqual([{ topic: "Brand Naming Strategy", bookIds: ["a", "b", "c"] }]);
  });

  it("keeps unrelated topics as separate singletons (dropped)", () => {
    // No word overlap → no edges → each is a 1-book component → dropped.
    expect(
      clusterByTopic([
        { bookId: "a", topic: "ai" },
        { bookId: "b", topic: "thermodynamics" },
      ]),
    ).toEqual([]);
  });

  it("still clusters exact topic matches", () => {
    const out = clusterByTopic([
      { bookId: "a", topic: "ai" },
      { bookId: "b", topic: "ai" },
      { bookId: "c", topic: "thermo" },
      { bookId: "d", topic: "thermo" },
    ]);
    const byTopic = Object.fromEntries(out.map((c) => [c.topic, c.bookIds]));
    expect(byTopic["ai"]).toEqual(["a", "b"]);
    expect(byTopic["thermo"]).toEqual(["c", "d"]);
  });

  it("drops singletons (a topic with only one book)", () => {
    expect(
      clusterByTopic([
        { bookId: "a", topic: "ai" },
        { bookId: "b", topic: "ai" },
        { bookId: "c", topic: "solo" },
      ]),
    ).toEqual([{ topic: "ai", bookIds: ["a", "b"] }]);
  });

  it("dedups the same bookId within a cluster if repeated", () => {
    expect(
      clusterByTopic([
        { bookId: "a", topic: "ai" },
        { bookId: "a", topic: "ai" },
        { bookId: "b", topic: "ai" },
      ]),
    ).toEqual([{ topic: "ai", bookIds: ["a", "b"] }]);
  });

  it("normalizes case + whitespace before word-overlap", () => {
    // All three collapse to the word-set {quantum, mechanics} → one cluster.
    const out = clusterByTopic([
      { bookId: "a", topic: "  Quantum  Mechanics  " },
      { bookId: "b", topic: "quantum mechanics" },
      { bookId: "c", topic: "QUANTUM MECHANICS" },
    ]);
    expect(out).toEqual([{ topic: "  Quantum  Mechanics  ", bookIds: ["a", "b", "c"] }]);
  });

  it("connects transitively: A~B and B~C cluster even if A∩C is small", () => {
    // a~b: inter {brand,naming}=2, union 4 → 0.50 ✓
    // b~c: inter {naming,logo}=2,  union 4 → 0.50 ✓
    // a~c: inter {naming}=1,        union 5 → 0.20 ✗ (no direct edge)
    // union-find still lands all three in ONE connected component via b.
    const out = clusterByTopic([
      { bookId: "a", topic: "brand naming identity" },
      { bookId: "b", topic: "brand naming logo" },
      { bookId: "c", topic: "naming logo typography" },
    ]);
    expect(out).toEqual([
      { topic: "brand naming identity", bookIds: ["a", "b", "c"] },
    ]);
  });

  it("is deterministic: same input → same output, stable order", () => {
    const input = [
      { bookId: "a", topic: "Brand Naming Strategy" },
      { bookId: "b", topic: "brand naming" },
      { bookId: "c", topic: "deep learning" },
      { bookId: "d", topic: "deep learning" },
    ];
    const run1 = clusterByTopic(input);
    const run2 = clusterByTopic(input);
    expect(run1).toEqual(run2);
  });
});
