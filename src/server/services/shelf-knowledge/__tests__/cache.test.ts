import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

vi.mock("../wiki-storage", () => ({
  readWikiFile: vi.fn(),
  writeWikiFile: vi.fn(),
  wikiExists: vi.fn(),
}));

import { readWikiFile, writeWikiFile, wikiExists } from "../wiki-storage";
import { cacheKey, getCached, setCached } from "../cache";

const expectedKey = (ns: string, input: string) =>
  crypto.createHash("sha256").update(ns).update("\x00").update(input).digest("hex");

describe("cache", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("cacheKey", () => {
    it("is stable: same namespace + input → same key", () => {
      expect(cacheKey("concepts", "chunk text")).toBe(cacheKey("concepts", "chunk text"));
    });

    it("is deterministic sha256(namespace + \\x00 + input), hex", () => {
      expect(cacheKey("concepts", "chunk text")).toBe(expectedKey("concepts", "chunk text"));
    });

    it("namespaces: different namespace → different key", () => {
      expect(cacheKey("concepts", "x")).not.toBe(cacheKey("synthesis", "x"));
    });

    it("separates fields with \\x00 so boundaries don't collide", () => {
      // ponytail: without the null separator, ("ab","c") and ("a","bc") would hash equal.
      expect(cacheKey("ab", "c")).not.toBe(cacheKey("a", "bc"));
    });
  });

  describe("setCached / getCached round-trip", () => {
    it("writes JSON to .cache/<ns>/<key>.json and reads it back", async () => {
      const value = { concepts: ["a", "b"], n: 2 };
      vi.mocked(writeWikiFile).mockResolvedValue("ignored");
      vi.mocked(wikiExists).mockResolvedValue(true);
      vi.mocked(readWikiFile).mockResolvedValue(JSON.stringify(value));

      await setCached("concepts", "chunk text", value);
      const got = await getCached("concepts", "chunk text");

      const expectedPath = `.cache/concepts/${cacheKey("concepts", "chunk text")}.json`;
      expect(writeWikiFile).toHaveBeenCalledWith(expectedPath, JSON.stringify(value));
      expect(wikiExists).toHaveBeenCalledWith(expectedPath);
      expect(readWikiFile).toHaveBeenCalledWith(expectedPath);
      expect(got).toEqual(value);
    });
  });

  describe("getCached miss", () => {
    it("returns null when wikiExists is false (and does not read)", async () => {
      vi.mocked(wikiExists).mockResolvedValue(false);

      const got = await getCached("synthesis", "missing");

      expect(got).toBeNull();
      expect(readWikiFile).not.toHaveBeenCalled();
    });

    it("returns null when read throws", async () => {
      vi.mocked(wikiExists).mockResolvedValue(true);
      vi.mocked(readWikiFile).mockRejectedValue(new Error("io"));

      const got = await getCached("synthesis", "boom");

      expect(got).toBeNull();
    });
  });

  describe("getCached corruption", () => {
    it("returns null (does not throw) when the file is unparseable JSON", async () => {
      vi.mocked(wikiExists).mockResolvedValue(true);
      vi.mocked(readWikiFile).mockResolvedValue("{not json");

      await expect(getCached("concepts", "corrupt")).resolves.toBeNull();
    });
  });
});
