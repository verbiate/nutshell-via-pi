import { describe, it, expect } from "vitest";
import { clusterByTopic } from "../cluster";

describe("clusterByTopic", () => {
  it("returns [] for empty input", () => {
    expect(clusterByTopic([])).toEqual([]);
  });

  it("normalizes topics: lowercase + trim + collapse internal whitespace", () => {
    const out = clusterByTopic([
      { bookId: "a", topic: "  Quantum  Mechanics  " },
      { bookId: "b", topic: "quantum mechanics" },
      { bookId: "c", topic: "QUANTUM MECHANICS" },
    ]);
    expect(out).toEqual([{ topic: "quantum mechanics", bookIds: ["a", "b", "c"] }]);
  });

  it("groups bookIds by normalized topic", () => {
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

  it("drops singletons (topics with only one book)", () => {
    const out = clusterByTopic([
      { bookId: "a", topic: "ai" },
      { bookId: "b", topic: "ai" },
      { bookId: "c", topic: "solo" },
    ]);
    expect(out).toEqual([{ topic: "ai", bookIds: ["a", "b"] }]);
  });

  it("dedups the same bookId within a topic if repeated", () => {
    const out = clusterByTopic([
      { bookId: "a", topic: "ai" },
      { bookId: "a", topic: "ai" },
      { bookId: "b", topic: "ai" },
    ]);
    expect(out).toEqual([{ topic: "ai", bookIds: ["a", "b"] }]);
  });
});
