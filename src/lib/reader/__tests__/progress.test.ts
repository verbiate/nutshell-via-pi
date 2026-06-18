import { describe, it, expect } from "vitest";
import { computeProgressPercent, type BookLike } from "../progress";

function makeStub(value: number | null): BookLike {
  return {
    locations: {
      percentageFromCfi: () => value,
    },
  };
}

describe("computeProgressPercent", () => {
  it("returns 0 when cfi is null", () => {
    const stub = makeStub(0.5);
    expect(computeProgressPercent(stub, null)).toBe(0);
  });

  it("returns 0 when cfi is empty string", () => {
    const stub = makeStub(0.5);
    expect(computeProgressPercent(stub, "")).toBe(0);
  });

  it("returns 0 when percentageFromCfi returns null", () => {
    const stub = makeStub(null);
    expect(computeProgressPercent(stub, "epubcfi(/6/4[chap01]!/4/2/1:0)")).toBe(0);
  });

  it("returns pct * 100 when percentageFromCfi returns a fraction", () => {
    const stub = makeStub(0.4231);
    expect(computeProgressPercent(stub, "epubcfi(/6/4[chap01]!/4/2/1:0)")).toBeCloseTo(
      42.31,
      5,
    );
  });

  it("clamps result to [0, 100]", () => {
    const high = makeStub(1.5);
    expect(computeProgressPercent(high, "epubcfi(/6/4[chap01]!/4/2/1:0)")).toBe(100);
    const low = makeStub(-0.2);
    expect(computeProgressPercent(low, "epubcfi(/6/4[chap01]!/4/2/1:0)")).toBe(0);
  });
});
