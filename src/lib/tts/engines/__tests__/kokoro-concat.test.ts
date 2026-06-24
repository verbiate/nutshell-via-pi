import { describe, it, expect } from "vitest";
import { concatFloat32 } from "../kokoro-engine";
import { chunkText } from "../../chunk";

describe("concatFloat32", () => {
  it("returns empty array for empty input", () => {
    const out = concatFloat32([], 10);
    expect(out.length).toBe(0);
  });

  it("returns the same array for a single part", () => {
    const a = new Float32Array([1, 2, 3]);
    const out = concatFloat32([a], 10);
    expect(out).toEqual(a);
  });

  it("concatenates multiple parts with no silence", () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([3, 4, 5]);
    const c = new Float32Array([6]);
    const out = concatFloat32([a, b, c], 0);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("inserts silence samples between parts", () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([3, 4]);
    const out = concatFloat32([a, b], 2);
    expect(Array.from(out)).toEqual([1, 2, 0, 0, 3, 4]);
  });
});

describe("kokoro inference chunking", () => {
  it("splits a long chunk into pieces under the inference hard limit", () => {
    const longText =
      "This is the first sentence of a long chunk. " +
      "Here is another sentence that adds more characters to the total. " +
      "A third sentence ensures we exceed two hundred and twenty characters comfortably. " +
      "Finally, this fourth sentence makes the chunk far too long for Kokoro to synthesize in one pass.";

    const pieces = chunkText(longText, { softLimit: 160, hardLimit: 220 });
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(220);
    }
  });
});
