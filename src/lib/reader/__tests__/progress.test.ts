import { describe, it, expect } from "vitest";
import { computeProgressPercent, shouldDisplayProgress, type BookLike } from "../progress";

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

describe("shouldDisplayProgress", () => {
  it("accepts everything when action direction is null (TOC/search/bookmark)", () => {
    expect(shouldDisplayProgress(30, 80, null, 10)).toBe(true);
    expect(shouldDisplayProgress(80, 30, null, 10)).toBe(true);
  });

  it("accepts everything outside the action window", () => {
    expect(shouldDisplayProgress(30, 80, "forward", 600)).toBe(true);
    expect(shouldDisplayProgress(80, 30, "backward", 600)).toBe(true);
  });

  it("rejects backward wobble during forward action within window", () => {
    expect(shouldDisplayProgress(45, 46, "forward", 100)).toBe(false);
  });

  it("rejects forward wobble during backward action within window", () => {
    expect(shouldDisplayProgress(46, 45, "backward", 100)).toBe(false);
  });

  it("accepts in-direction movement during forward action", () => {
    expect(shouldDisplayProgress(47, 46, "forward", 100)).toBe(true);
    expect(shouldDisplayProgress(46, 46, "forward", 100)).toBe(true);
  });

  it("accepts in-direction movement during backward action", () => {
    expect(shouldDisplayProgress(44, 45, "backward", 100)).toBe(true);
    expect(shouldDisplayProgress(45, 45, "backward", 100)).toBe(true);
  });

  it("honors custom windowMs", () => {
    expect(shouldDisplayProgress(45, 46, "forward", 250, 500)).toBe(false);
    expect(shouldDisplayProgress(45, 46, "forward", 600, 500)).toBe(true);
  });
});
