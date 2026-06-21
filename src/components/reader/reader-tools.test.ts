import { describe, it, expect } from "vitest";
import { READER_TOOLS } from "./reader-tools";

describe("READER_TOOLS", () => {
  it("has five tools in screenshot order", () => {
    expect(READER_TOOLS.map((t) => t.id)).toEqual([
      "reader",
      "bookmark",
      "pen",
      "bulb",
      "type",
    ]);
  });

  it("every tool has a label, description, and icon key", () => {
    for (const tool of READER_TOOLS) {
      expect(typeof tool.label).toBe("string");
      expect(tool.label.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.icon).toBe("string");
    }
  });

  it("uses unique ids", () => {
    const ids = READER_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
