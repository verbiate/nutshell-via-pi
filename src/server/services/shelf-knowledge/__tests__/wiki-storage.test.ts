import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/storage/local", () => ({
  storage: {
    write: vi.fn(),
    read: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("fs/promises", () => ({
  default: { readdir: vi.fn() },
}));

import { storage } from "@/server/storage/local";
import fs from "fs/promises";
import {
  readWikiFile,
  writeWikiFile,
  listWikiFiles,
  removeWikiFile,
  wikiExists,
} from "../wiki-storage";

const file = (name: string) => ({
  name,
  isFile: () => true,
});
const dir = (name: string) => ({
  name,
  isFile: () => false,
});

describe("wiki-storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STORAGE_PATH = "/test/storage";
  });

  describe("writeWikiFile", () => {
    it("delegates to storage.write with the shelf-wiki/ prefix and returns the input rel", async () => {
      vi.mocked(storage.write).mockResolvedValue("shelf-wiki/foo.md");

      const out = await writeWikiFile("foo.md", "# body");

      expect(storage.write).toHaveBeenCalledWith("shelf-wiki/foo.md", "# body");
      expect(out).toBe("foo.md");
    });
  });

  describe("readWikiFile", () => {
    it("reads via storage.read with prefix and returns a utf-8 string", async () => {
      vi.mocked(storage.read).mockResolvedValue(Buffer.from("héllo", "utf-8"));

      const out = await readWikiFile("notes/a.md");

      expect(storage.read).toHaveBeenCalledWith("shelf-wiki/notes/a.md");
      expect(out).toBe("héllo");
    });
  });

  describe("wikiExists", () => {
    it("delegates to storage.exists with the prefix", async () => {
      vi.mocked(storage.exists).mockResolvedValue(true);

      const out = await wikiExists("x.md");

      expect(storage.exists).toHaveBeenCalledWith("shelf-wiki/x.md");
      expect(out).toBe(true);
    });
  });

  describe("removeWikiFile", () => {
    it("delegates to storage.delete with the prefix", async () => {
      await removeWikiFile("gone.md");

      expect(storage.delete).toHaveBeenCalledWith("shelf-wiki/gone.md");
    });
  });

  describe("listWikiFiles", () => {
    it("scans the wiki root recursively and returns file paths relative to shelf-wiki/", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        dir("foo"),
        file("foo/a.md"),
        file("foo/b.md"),
        file("top.md"),
      ] as any);

      const out = await listWikiFiles();

      expect(fs.readdir).toHaveBeenCalledWith(
        "/test/storage/shelf-wiki",
        expect.objectContaining({ recursive: true, withFileTypes: true }),
      );
      expect(out.sort()).toEqual(["foo/a.md", "foo/b.md", "top.md"]);
    });

    it("scopes to shelf-wiki/<prefix> and re-prefixes returned paths", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        file("a.md"),
        file("nested/b.md"),
      ] as any);

      const out = await listWikiFiles("foo");

      expect(fs.readdir).toHaveBeenCalledWith(
        "/test/storage/shelf-wiki/foo",
        expect.objectContaining({ recursive: true, withFileTypes: true }),
      );
      expect(out.sort()).toEqual(["foo/a.md", "foo/nested/b.md"]);
    });

    it("returns [] when the wiki root does not exist", async () => {
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      vi.mocked(fs.readdir).mockRejectedValue(err);

      const out = await listWikiFiles();

      expect(out).toEqual([]);
    });
  });

  describe("path traversal guard", () => {
    it("rejects rel/prefix strings that escape the wiki root", async () => {
      await expect(readWikiFile("../etc/passwd")).rejects.toThrow(/escapes root/);
      await expect(readWikiFile("foo/../../etc")).rejects.toThrow(/escapes root/);
      await expect(writeWikiFile("../x", "y")).rejects.toThrow(/escapes root/);
      await expect(removeWikiFile("../x")).rejects.toThrow(/escapes root/);
      await expect(wikiExists("../x")).rejects.toThrow(/escapes root/);
      await expect(listWikiFiles("../x")).rejects.toThrow(/escapes root/);
    });

    it("allows clean rel paths through to the storage adapter", async () => {
      vi.mocked(storage.read).mockResolvedValue(Buffer.from("ok", "utf-8"));

      await expect(readWikiFile("notes/a.md")).resolves.toBe("ok");
      expect(storage.read).toHaveBeenCalledWith("shelf-wiki/notes/a.md");
    });
  });
});
