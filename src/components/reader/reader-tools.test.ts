import { describe, it, expect } from "vitest";
import { READER_TOOLS, sectionNumberFor } from "./reader-tools";

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

  it("every tool has a label and icon key", () => {
    for (const tool of READER_TOOLS) {
      expect(typeof tool.label).toBe("string");
      expect(tool.label.length).toBeGreaterThan(0);
      expect(typeof tool.icon).toBe("string");
    }
  });

  it("uses unique ids", () => {
    const ids = READER_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("sectionNumberFor", () => {
  it("maps each tool to its 1-based screenshot position", () => {
    expect(sectionNumberFor("reader")).toBe(1);
    expect(sectionNumberFor("bookmark")).toBe(2);
    expect(sectionNumberFor("pen")).toBe(3);
    expect(sectionNumberFor("bulb")).toBe(4);
    expect(sectionNumberFor("type")).toBe(5);
  });

  it("returns 0 for an unknown tool id", () => {
    expect(sectionNumberFor("nope" as never)).toBe(0);
  });
});
