import { describe, it, expect } from "vitest";
import { validateEpub, streamHash } from "@/server/services/epub-processor";

describe("LIB-01..04: EPUB Processing", () => {
  describe("validateEpub", () => {
    it("rejects non-EPUB files", () => {
      const file = new File([], "test.pdf", { type: "application/pdf" });
      expect(validateEpub(file)).toBe("Only EPUB files are accepted");
    });

    it("rejects files larger than 50MB", () => {
      const file = new File([], "test.epub");
      Object.defineProperty(file, "size", { value: 51 * 1024 * 1024 });
      expect(validateEpub(file)).toBe("File size must be under 50MB");
    });

    it("accepts valid EPUB files under 50MB", () => {
      const file = new File([], "test.epub", { type: "application/epub+zip" });
      Object.defineProperty(file, "size", { value: 1024 * 1024 });
      expect(validateEpub(file)).toBeNull();
    });

    it("is case-insensitive for extension check", () => {
      const file = new File([], "TEST.EPUB");
      Object.defineProperty(file, "size", { value: 1024 });
      expect(validateEpub(file)).toBeNull();
    });
  });

  describe("streamHash", () => {
    it("computes MD5 hash from a stream", async () => {
      const encoder = new TextEncoder();
      const data = encoder.encode("test content for hashing");
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });

      const hash = await streamHash(stream);
      expect(hash).toMatch(/^[a-f0-9]{32}$/);
    });

    it("produces consistent hash for same content", async () => {
      const createStream = () => {
        const encoder = new TextEncoder();
        const data = encoder.encode("consistent test content");
        return new ReadableStream({
          start(controller) {
            controller.enqueue(data);
            controller.close();
          },
        });
      };

      const hash1 = await streamHash(createStream());
      const hash2 = await streamHash(createStream());
      expect(hash1).toBe(hash2);
    });
  });
});
