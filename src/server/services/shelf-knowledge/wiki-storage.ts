import fs from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import { storage } from "@/server/storage/local";

const WIKI_PREFIX = "shelf-wiki";

// ponytail: STORAGE_ROOT re-derived here (local.ts keeps it private). If a
// second caller needs the same value, export it from local.ts instead.
const storageRoot = () => process.env.STORAGE_PATH || "./data/uploads";

// ponytail: path-traversal guard at the storage-adapter chokepoint — every
// public fn routes rel through here, so callers can pass untrusted strings
// without re-sanitizing.
const wikiPath = (rel: string) => {
  const p = path.posix.normalize(rel).replace(/^\/+/, "");
  if (p === ".." || p.startsWith("../") || p.includes("/../") || p === ".")
    throw new Error(`wiki path escapes root: ${rel}`);
  return path.posix.join(WIKI_PREFIX, p);
};

export async function readWikiFile(rel: string): Promise<string> {
  const buf = await storage.read(wikiPath(rel));
  return buf.toString("utf-8");
}

// ponytail: returns the input `rel` (not storage.write's value) by design —
// callers depend on the rel-to-shelf-wiki contract. Don't pass through
// storage.write's return here.
export async function writeWikiFile(rel: string, content: string): Promise<string> {
  await storage.write(wikiPath(rel), content);
  return rel;
}

export async function wikiExists(rel: string): Promise<boolean> {
  return storage.exists(wikiPath(rel));
}

export async function removeWikiFile(rel: string): Promise<void> {
  await storage.delete(wikiPath(rel));
}

// ponytail: touches fs directly because the StorageProvider has no list().
// Add list() to StorageProvider if a second caller appears.
export async function listWikiFiles(prefix = ""): Promise<string[]> {
  // ponytail: same traversal guard as wikiPath; empty/dot prefix = scan whole
  // wiki root (valid), so the `.` check is omitted here.
  const p = prefix ? path.posix.normalize(prefix).replace(/^\/+/, "") : "";
  if (p === ".." || p.startsWith("../") || p.includes("/../"))
    throw new Error(`wiki prefix escapes root: ${prefix}`);
  const scanRoot = path.join(storageRoot(), WIKI_PREFIX, p);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(scanRoot, { recursive: true, withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    out.push(p ? path.posix.join(p, e.name) : e.name);
  }
  return out;
}
