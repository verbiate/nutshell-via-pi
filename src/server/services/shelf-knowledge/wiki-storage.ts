import fs from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import { storage } from "@/server/storage/local";

const WIKI_PREFIX = "shelf-wiki";

// ponytail: STORAGE_ROOT re-derived here (local.ts keeps it private). If a
// second caller needs the same value, export it from local.ts instead.
const storageRoot = () => process.env.STORAGE_PATH || "./data/uploads";
const wikiPath = (rel: string) => path.posix.join(WIKI_PREFIX, rel);

export async function readWikiFile(rel: string): Promise<string> {
  const buf = await storage.read(wikiPath(rel));
  return buf.toString("utf-8");
}

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
  const scanRoot = path.join(storageRoot(), WIKI_PREFIX, prefix);
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
    out.push(prefix ? path.posix.join(prefix, e.name) : e.name);
  }
  return out;
}
