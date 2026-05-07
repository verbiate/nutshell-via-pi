import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { StorageProvider } from "./types";

const STORAGE_ROOT = process.env.STORAGE_PATH || "./data/uploads";

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
    return fullPath;
  }

  async read(relativePath: string): Promise<Buffer> {
    const fullPath = path.join(STORAGE_ROOT, relativePath);
    return fs.readFile(fullPath);
  }

  async exists(relativePath: string): Promise<boolean> {
    const fullPath = path.join(STORAGE_ROOT, relativePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(relativePath: string): Promise<void> {
    const fullPath = path.join(STORAGE_ROOT, relativePath);
    await fs.unlink(fullPath).catch(() => {});
  }

  getUrl(relativePath: string): string {
    return `/api/files/${relativePath}`;
  }
}

export const storage = new LocalStorage();
