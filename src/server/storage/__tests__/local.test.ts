import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";

import type { LocalStorage } from "../local";

let storage: LocalStorage;
let storageRoot: string;
let moduleDir: string;

beforeEach(async () => {
  moduleDir = mkdtempSync(path.join(tmpdir(), "local-storage-test-"));
  storageRoot = moduleDir;
  process.env.STORAGE_PATH = moduleDir;
  vi.resetModules();
  const mod = await import("../local");
  storage = new mod.LocalStorage();
});

afterEach(() => {
  delete process.env.STORAGE_PATH;
  if (moduleDir) rmSync(moduleDir, { recursive: true, force: true });
});

describe("LocalStorage.write", () => {
  it("writes a Buffer to disk under storage root + relativePath", async () => {
    const rel = "epubs/book.epub";
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    await storage.write(rel, buf);

    const onDisk = readFileSync(path.join(storageRoot, rel));
    expect(onDisk.equals(buf)).toBe(true);
  });

  it("writes a string to disk equivalently", async () => {
    const rel = "notes/readme.txt";
    const content = "hello storage";
    await storage.write(rel, content);

    const onDisk = readFileSync(path.join(storageRoot, rel), "utf8");
    expect(onDisk).toBe(content);
  });

  it("creates parent directories for nested relativePath", async () => {
    const rel = "a/b/c/file.txt";
    await storage.write(rel, "deep");

    expect(existsSync(path.join(storageRoot, rel))).toBe(true);
  });

  it("returns the relative path, not the full path", async () => {
    const rel = "epubs/x.epub";
    const result = await storage.write(rel, "data");
    expect(result).toBe(rel);
    expect(result).not.toContain(storageRoot);
  });

  it("round-trips: write then read returns the same bytes", async () => {
    const rel = "round/trip.bin";
    const payload = Buffer.from("round-trip-payload");
    await storage.write(rel, payload);

    const read = await storage.read(rel);
    expect(read.equals(payload)).toBe(true);
  });
});

describe("LocalStorage.read", () => {
  it("reads a file written via write", async () => {
    const rel = "read/me.txt";
    await storage.write(rel, "payload");
    const buf = await storage.read(rel);
    expect(buf.toString("utf8")).toBe("payload");
  });

  it("handles legacy full-path format (used as-is, not double-prefixed)", async () => {
    const rel = "legacy/book.epub";
    await storage.write(rel, "legacy-bytes");

    const fullLegacy = path.join(storageRoot, rel);
    const buf = await storage.read(fullLegacy);
    expect(buf.toString("utf8")).toBe("legacy-bytes");
  });

  it("throws ENOENT on missing file", async () => {
    await expect(storage.read("no/such/file")).rejects.toThrow(/ENOENT/);
  });
});

describe("LocalStorage.exists", () => {
  it("returns true for a file that exists", async () => {
    const rel = "here.txt";
    await storage.write(rel, "x");
    expect(await storage.exists(rel)).toBe(true);
  });

  it("returns false for a file that does not exist", async () => {
    expect(await storage.exists("missing.txt")).toBe(false);
  });
});

describe("LocalStorage.delete", () => {
  it("removes the file", async () => {
    const rel = "delete/me.txt";
    await storage.write(rel, "x");
    expect(existsSync(path.join(storageRoot, rel))).toBe(true);

    await storage.delete(rel);
    expect(existsSync(path.join(storageRoot, rel))).toBe(false);
  });

  it("does not throw when the file is missing", async () => {
    await expect(storage.delete("never/existed")).resolves.toBeUndefined();
  });
});

describe("LocalStorage.getUrl", () => {
  it("returns /api/files/${relativePath}", () => {
    expect(storage.getUrl("epubs/abc.epub")).toBe("/api/files/epubs/abc.epub");
  });
});
