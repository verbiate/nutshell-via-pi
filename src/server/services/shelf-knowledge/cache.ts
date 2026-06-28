import crypto from "node:crypto";
import path from "node:path";
import { readWikiFile, writeWikiFile, wikiExists } from "./wiki-storage";

// ponytail: null-byte separator mirrors explainer.ts:106 — prevents field-boundary
// collisions so ("ab","c") and ("a","bc") hash differently.
export function cacheKey(namespace: string, input: string): string {
  return crypto
    .createHash("sha256")
    .update(namespace)
    .update("\x00")
    .update(input)
    .digest("hex");
}

const cachePath = (namespace: string, input: string) =>
  path.posix.join(".cache", namespace, `${cacheKey(namespace, input)}.json`);

export async function getCached<T>(
  namespace: string,
  input: string,
): Promise<T | null> {
  const rel = cachePath(namespace, input);
  if (!(await wikiExists(rel))) return null;
  try {
    return JSON.parse(await readWikiFile(rel)) as T;
  } catch {
    // miss (read threw) or corrupted-unparseable file → caller re-computes.
    return null;
  }
}

export async function setCached<T>(
  namespace: string,
  input: string,
  value: T,
): Promise<void> {
  await writeWikiFile(cachePath(namespace, input), JSON.stringify(value));
}
