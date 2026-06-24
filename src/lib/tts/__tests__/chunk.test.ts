import { describe, it, expect } from "vitest";
import { chunkText, CHUNK_LIMITS } from "../chunk";

const LIMITS = { softLimit: 40, hardLimit: 60 };

describe("chunkText", () => {
  it("packs short sentences under softLimit", () => {
    const text = "One. Two. Three. Four.";
    const chunks = chunkText(text, LIMITS);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe("One. Two. Three. Four.");
  });

  it("splits when softLimit is crossed and extension not allowed", () => {
    const text = "This is a fairly long first sentence indeed. Then another one here.";
    const chunks = chunkText(text, LIMITS);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(LIMITS.hardLimit);
    }
  });

  it("extends to hardLimit only when current is under softLimit", () => {
    // Each sentence is 25 chars incl space/punct; soft=40, hard=60
    // First two sentences = 25 + 1 + 25 = 51 <= hardLimit, > softLimit
    // Current after first = 25 (< softLimit), so extension allowed.
    const text = "Abcdef ghijklmnopqr. Xyzab cdefghijklmno. Short.";
    const chunks = chunkText(text, LIMITS);
    expect(chunks[0].length).toBeGreaterThan(LIMITS.softLimit);
    expect(chunks[0].length).toBeLessThanOrEqual(LIMITS.hardLimit);
  });

  it("cascades a single sentence longer than hardLimit", () => {
    const text = "A".repeat(150);
    const chunks = chunkText(text, LIMITS);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(LIMITS.hardLimit);
    }
  });

  it("uses clause boundaries during cascade", () => {
    const segment = "word ".repeat(30).trim();
    const text = `${segment}, ${segment}, ${segment}.`;
    const chunks = chunkText(text, LIMITS);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(LIMITS.hardLimit);
    }
  });

  it("preserves paragraph breaks as cascade boundaries", () => {
    const para = "Word ".repeat(15).trim();
    const text = `${para}\n\n${para}\n\n${para}.`;
    const chunks = chunkText(text, LIMITS);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(LIMITS.hardLimit);
    }
  });

  it("hard-cuts when no boundary exists", () => {
    const text = "A".repeat(200);
    const chunks = chunkText(text, LIMITS);
    expect(chunks.length).toBe(Math.ceil(200 / LIMITS.hardLimit));
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(LIMITS.hardLimit);
    }
  });

  it("uses CHUNK_LIMITS constants", () => {
    expect(CHUNK_LIMITS.kokoro.softLimit).toBe(180);
    expect(CHUNK_LIMITS.kokoro.hardLimit).toBe(260);
    expect(CHUNK_LIMITS.supertonic.softLimit).toBe(180);
    expect(CHUNK_LIMITS.supertonic.hardLimit).toBe(260);
    expect(CHUNK_LIMITS.browser.softLimit).toBe(180);
    expect(CHUNK_LIMITS.browser.hardLimit).toBe(260);
    expect(CHUNK_LIMITS.cloud.softLimit).toBe(4500);
    expect(CHUNK_LIMITS.cloud.hardLimit).toBe(5000);
  });
});
