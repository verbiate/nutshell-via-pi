import { describe, it, expect } from "vitest";
import {
  computeThumbHeight,
  computeThumbTranslateY,
  scrollFromDrag,
} from "../scrollbar-math";

describe("computeThumbHeight", () => {
  it("scales thumb proportionally for tall content", () => {
    expect(
      computeThumbHeight({ clientHeight: 500, scrollHeight: 2000 }),
    ).toBe(125);
  });

  it("fills the track when content fits exactly (no scroll)", () => {
    expect(
      computeThumbHeight({ clientHeight: 500, scrollHeight: 500 }),
    ).toBe(500);
  });

  it("clamps to default minThumbPx when ratio would shrink thumb", () => {
    expect(
      computeThumbHeight({ clientHeight: 100, scrollHeight: 100000 }),
    ).toBe(24);
  });

  it("honors a custom minThumbPx", () => {
    expect(
      computeThumbHeight({
        clientHeight: 100,
        scrollHeight: 100000,
        minThumbPx: 40,
      }),
    ).toBe(40);
  });

  it("fills the track when scrollHeight is less than clientHeight", () => {
    expect(
      computeThumbHeight({ clientHeight: 500, scrollHeight: 300 }),
    ).toBe(500);
  });
});

describe("computeThumbTranslateY", () => {
  it("moves proportionally at mid-scroll", () => {
    expect(
      computeThumbTranslateY({
        scrollTop: 500,
        scrollHeight: 2000,
        clientHeight: 500,
        thumbHeight: 125,
      }),
    ).toBe(125);
  });

  it("returns 0 at the top", () => {
    expect(
      computeThumbTranslateY({
        scrollTop: 0,
        scrollHeight: 2000,
        clientHeight: 500,
        thumbHeight: 125,
      }),
    ).toBe(0);
  });

  it("returns clientHeight - thumbHeight at the bottom", () => {
    expect(
      computeThumbTranslateY({
        scrollTop: 1500,
        scrollHeight: 2000,
        clientHeight: 500,
        thumbHeight: 125,
      }),
    ).toBe(375);
  });

  it("returns 0 in a no-scroll region (no divide-by-zero)", () => {
    expect(
      computeThumbTranslateY({
        scrollTop: 0,
        scrollHeight: 500,
        clientHeight: 500,
        thumbHeight: 500,
      }),
    ).toBe(0);
  });

  it("clamps negative scrollTop to 0", () => {
    expect(
      computeThumbTranslateY({
        scrollTop: -50,
        scrollHeight: 2000,
        clientHeight: 500,
        thumbHeight: 125,
      }),
    ).toBe(0);
  });

  it("clamps scrollTop beyond max to the max translate", () => {
    expect(
      computeThumbTranslateY({
        scrollTop: 9999,
        scrollHeight: 2000,
        clientHeight: 500,
        thumbHeight: 125,
      }),
    ).toBe(375);
  });
});

describe("scrollFromDrag", () => {
  it("maps dragRatio 0 to scrollTop 0", () => {
    expect(
      scrollFromDrag({ dragRatio: 0, scrollHeight: 2000, clientHeight: 500 }),
    ).toBe(0);
  });

  it("maps dragRatio 1 to max scrollTop", () => {
    expect(
      scrollFromDrag({ dragRatio: 1, scrollHeight: 2000, clientHeight: 500 }),
    ).toBe(1500);
  });

  it("maps dragRatio 0.5 to the midpoint of scrollable distance", () => {
    expect(
      scrollFromDrag({
        dragRatio: 0.5,
        scrollHeight: 2000,
        clientHeight: 500,
      }),
    ).toBe(750);
  });

  it("clamps dragRatio > 1 to 1 (max scrollTop)", () => {
    expect(
      scrollFromDrag({
        dragRatio: 2,
        scrollHeight: 2000,
        clientHeight: 500,
      }),
    ).toBe(1500);
  });

  it("clamps dragRatio < 0 to 0", () => {
    expect(
      scrollFromDrag({
        dragRatio: -0.5,
        scrollHeight: 2000,
        clientHeight: 500,
      }),
    ).toBe(0);
  });

  it("returns 0 in a no-scroll region", () => {
    expect(
      scrollFromDrag({ dragRatio: 0.5, scrollHeight: 500, clientHeight: 500 }),
    ).toBe(0);
  });
});
