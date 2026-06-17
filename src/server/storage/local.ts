import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { StorageProvider } from "./types";

const STORAGE_ROOT = process.env.STORAGE_PATH || "./data/uploads";

function resolveFilePath(storedPath: string): string {
  const normalizedRoot = STORAGE_ROOT.replace(/^\.\//, "");
  // Handle legacy full paths stored in DB (e.g. "data/uploads/epubs/xxx.epub")
  // as well as clean relative paths (e.g. "epubs/xxx.epub").
  if (storedPath.startsWith(normalizedRoot + "/")) {
    return storedPath;
  }
  return path.join(STORAGE_ROOT, storedPath);
}

export class LocalStorage implements StorageProvider {
  async write(relativePath: string, data: Buffer | string | NodeJS.ReadableStream): Promise<string> {
    const fullPath = path.join(STORAGE_ROOT, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    if (typeof data === "string" || Buffer.isBuffer(data)) {
      await fs.writeFile(fullPath, data);
    } else {
      const writer = createWriteStream(fullPath);
      await new Promise<void>((resolve, reject) => {
        data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
    }
    // Return relative path so callers store a clean, reproducible reference.
    return relativePath;
  }

  async read(storedPath: string): Promise<Buffer> {
    const filePath = resolveFilePath(storedPath);
    return fs.readFile(filePath);
  }

  async exists(storedPath: string): Promise<boolean> {
    const filePath = resolveFilePath(storedPath);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(storedPath: string): Promise<void> {
    const filePath = resolveFilePath(storedPath);
    await fs.unlink(filePath).catch(() => {});
  }

  getUrl(relativePath: string): string {
    return `/api/files/${relativePath}`;
  }
}

export const storage = new LocalStorage();
