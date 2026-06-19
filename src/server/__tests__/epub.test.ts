import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  validateEpub,
  streamHash,
  parseEpub,
} from "@/server/services/epub-processor";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64"
);

const MINIMAL_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const CONTAINER_XML =
  '<?xml version="1.0"?>' +
  '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
  '<rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
  "</container>";

async function buildEpub(
  opf: string,
  files: Record<string, Buffer | string>
): Promise<File> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("content.opf", opf);
  for (const [name, data] of Object.entries(files)) {
    zip.file(name, data);
  }
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return new File([buf as BlobPart], "test.epub", {
    type: "application/epub+zip",
  });
}

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

describe("parseEpub cover extraction", () => {
  it("extracts cover when href precedes properties (cover-image property)", async () => {
    const opf =
      '<?xml version="1.0"?>' +
      '<package version="3.0" xmlns="http://www.idpf.org/2007/opf">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      "<dc:title>Test Book</dc:title>" +
      "</metadata>" +
      "<manifest>" +
      '<item href="cover.png" id="cover" media-type="image/png" properties="cover-image"/>' +
      '<item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>' +
      "</manifest>" +
      '<spine><itemref idref="ch1"/></spine>' +
      "</package>";

    const file = await buildEpub(opf, {
      "cover.png": ONE_BY_ONE_PNG,
      "chapter1.xhtml": "<html><body><p>Hello</p></body></html>",
    });

    const parsed = await parseEpub(file);
    expect(parsed.coverBuffer).toBeInstanceOf(Buffer);
    expect(parsed.coverBuffer!.length).toBeGreaterThan(0);
    expect(parsed.coverMediaType).toBe("image/png");
  });

  it("extracts cover via <meta name=cover> fallback when href precedes id", async () => {
    const opf =
      '<?xml version="1.0"?>' +
      '<package version="3.0" xmlns="http://www.idpf.org/2007/opf">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      "<dc:title>Meta Cover Book</dc:title>" +
      '<meta name="cover" content="cover"/>' +
      "</metadata>" +
      "<manifest>" +
      '<item href="cover.jpg" id="cover" media-type="image/jpeg"/>' +
      '<item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>' +
      "</manifest>" +
      '<spine><itemref idref="ch1"/></spine>' +
      "</package>";

    const file = await buildEpub(opf, {
      "cover.jpg": MINIMAL_JPEG,
      "chapter1.xhtml": "<html><body><p>Hello</p></body></html>",
    });

    const parsed = await parseEpub(file);
    expect(parsed.coverBuffer).toBeInstanceOf(Buffer);
    expect(parsed.coverBuffer!.length).toBeGreaterThan(0);
    expect(parsed.coverMediaType).toBe("image/jpeg");
  });
});

describe("parseEpub text and toc extraction", () => {
  it("extracts text when manifest item has href before id", async () => {
    const opf =
      '<?xml version="1.0"?>' +
      '<package version="3.0" xmlns="http://www.idpf.org/2007/opf">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      "<dc:title>Text Order Book</dc:title>" +
      "</metadata>" +
      "<manifest>" +
      '<item href="ch1.xhtml" id="ch1" media-type="application/xhtml+xml"/>' +
      "</manifest>" +
      '<spine><itemref idref="ch1"/></spine>' +
      "</package>";

    const file = await buildEpub(opf, {
      "ch1.xhtml":
        "<html><body><p>The quick brown fox jumps over the lazy dog.</p></body></html>",
    });

    const parsed = await parseEpub(file);
    expect(parsed.text).toContain("quick brown fox");
  });

  it("extracts EPUB3 TOC when nav item has href before properties", async () => {
    const opf =
      '<?xml version="1.0"?>' +
      '<package version="3.0" xmlns="http://www.idpf.org/2007/opf">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      "<dc:title>Nav Order Book</dc:title>" +
      "</metadata>" +
      "<manifest>" +
      '<item href="nav.xhtml" id="nav" media-type="application/xhtml+xml" properties="nav"/>' +
      '<item href="ch1.xhtml" id="ch1" media-type="application/xhtml+xml"/>' +
      "</manifest>" +
      '<spine><itemref idref="ch1"/></spine>' +
      "</package>";

    const file = await buildEpub(opf, {
      "nav.xhtml":
        '<nav epub:type="toc"><ol><li><a href="ch1.xhtml">Chapter One</a></li></ol></nav>',
      "ch1.xhtml": "<html><body><p>Body</p></body></html>",
    });

    const parsed = await parseEpub(file);
    expect(parsed.toc.length).toBeGreaterThanOrEqual(1);
    expect(parsed.toc.some((t) => t.title === "Chapter One")).toBe(true);
  });

  it("extracts EVERY nav link, not just the first (multi-link TOC)", async () => {
    const opf =
      '<?xml version="1.0"?>' +
      '<package version="3.0" xmlns="http://www.idpf.org/2007/opf">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      "<dc:title>Multi Link Book</dc:title>" +
      "</metadata>" +
      "<manifest>" +
      '<item href="nav.xhtml" id="nav" media-type="application/xhtml+xml" properties="nav"/>' +
      '<item href="ch1.xhtml" id="ch1" media-type="application/xhtml+xml"/>' +
      "</manifest>" +
      '<spine><itemref idref="ch1"/></spine>' +
      "</package>";

    const file = await buildEpub(opf, {
      "nav.xhtml":
        '<nav epub:type="toc"><ol>' +
        '<li><a href="ch1.xhtml">Chapter One</a></li>' +
        '<li><a href="ch2.xhtml">Chapter Two</a></li>' +
        '<li><a href="ch3.xhtml">Chapter Three</a></li>' +
        "</ol></nav>",
      "ch1.xhtml": "<html><body><p>Body</p></body></html>",
    });

    const parsed = await parseEpub(file);
    expect(parsed.toc.length).toBe(3);
    expect(parsed.toc.map((t) => t.title)).toEqual(
      expect.arrayContaining([
        "Chapter One",
        "Chapter Two",
        "Chapter Three",
      ])
    );
  });

  it("extracts EPUB2 NCX TOC when ncx item has href before media-type", async () => {
    const opf =
      '<?xml version="1.0"?>' +
      '<package version="2.0" xmlns="http://www.idpf.org/2007/opf">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      "<dc:title>NCX Order Book</dc:title>" +
      "</metadata>" +
      "<manifest>" +
      '<item href="toc.ncx" id="ncx" media-type="application/x-dtbncx+xml"/>' +
      '<item href="ch1.xhtml" id="ch1" media-type="application/xhtml+xml"/>' +
      "</manifest>" +
      '<spine><itemref idref="ch1"/></spine>' +
      "</package>";

    const file = await buildEpub(opf, {
      "toc.ncx":
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">' +
        "<navMap>" +
        '<navPoint id="n1"><navLabel><text>Intro</text></navLabel>' +
        '<content src="ch1.xhtml"/></navPoint>' +
        "</navMap>" +
        "</ncx>",
      "ch1.xhtml": "<html><body><p>Body</p></body></html>",
    });

    const parsed = await parseEpub(file);
    expect(parsed.toc.length).toBeGreaterThanOrEqual(1);
    expect(parsed.toc.some((t) => t.title === "Intro")).toBe(true);
  });
});
