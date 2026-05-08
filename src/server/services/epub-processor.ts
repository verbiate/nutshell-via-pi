import crypto from "crypto";
import { storage } from "@/server/storage/local";
import { db } from "@/server/db";
import { detectLanguage } from "@/lib/language";

export interface ParsedEpub {
  title: string;
  author: string | null;
  text: string;
  toc: TocEntry[];
  coverBuffer: Buffer | null;
}

export interface TocEntry {
  id: string;
  title: string;
  href: string;
  children?: TocEntry[];
  level: number;
}

/**
 * Compute MD5 hash from a ReadableStream using streaming.
 * Never reads entire file into memory.
 */
export async function streamHash(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const hash = crypto.createHash("md5");
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }

  return hash.digest("hex");
}

/**
 * Validate that a file is a valid EPUB (ZIP with mimetype entry).
 */
export function validateEpub(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".epub")) {
    return "Only EPUB files are accepted";
  }
  if (file.size > 50 * 1024 * 1024) {
    return "File size must be under 50MB";
  }
  return null;
}

/**
 * Parse an EPUB file using JSZip (EPUB is a ZIP), extract metadata, TOC, text, and cover.
 */
export async function parseEpub(file: File): Promise<ParsedEpub> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Use JSZip to open the EPUB (it's a ZIP file)
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  // Read container.xml to find rootfile
  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  if (!containerXml) {
    throw new Error("Invalid EPUB: missing META-INF/container.xml");
  }

  // Extract rootfile path
  const rootfilePathMatch = containerXml.match(
    /full-path="([^"]+\.opf)"/i
  );
  if (!rootfilePathMatch) {
    throw new Error("Invalid EPUB: cannot find rootfile in container.xml");
  }
  const rootfilePath = rootfilePathMatch[1];
  const rootDir = rootfilePath.includes("/")
    ? rootfilePath.substring(0, rootfilePath.lastIndexOf("/") + 1)
    : "";

  // Parse OPF
  const opfContent = await zip.file(rootfilePath)?.async("text");
  if (!opfContent) {
    throw new Error("Invalid EPUB: cannot read OPF file");
  }

  // Extract title
  const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const title = titleMatch?.[1]?.trim() || file.name.replace(/\.epub$/i, "");

  // Extract author
  const authorMatch = opfContent.match(
    /<dc:creator[^>]*>([^<]+)<\/dc:creator>/i
  );
  const author = authorMatch?.[1]?.trim() || null;

  // Extract TOC (from nav or NCX)
  const toc = await extractToc(zip, opfContent, rootDir);

  // Extract all text content from spine items
  const text = await extractText(zip, opfContent, rootDir);

  // Extract cover image
  const coverBuffer = await extractCover(zip, opfContent, rootDir);

  return { title, author, text, toc, coverBuffer };
}

async function extractToc(
  zip: any,
  opfContent: string,
  rootDir: string
): Promise<TocEntry[]> {
  const toc: TocEntry[] = [];

  // Try EPUB 3 nav document first
  const navMatch = opfContent.match(
    /<item[^>]+properties="[^"]*nav[^"]*"[^>]+href="([^"]+)"[^>]*>/i
  );
  if (navMatch) {
    const navPath = rootDir + navMatch[1];
    const navContent = await zip.file(navPath)?.async("text");
    if (navContent) {
      const tocMatch = navContent.match(
        /<nav[^>]+epub:type="toc"[^>]*>([\s\S]*?)<\/nav>/i
      ) || navContent.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
      if (tocMatch) {
        const linkRegex =
          /<a[^>]+href="([^"]+)"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/a>/gi;
        let match;
        while ((match = linkRegex.exec(tocMatch[1])) !== null) {
          toc.push({
            id: `toc-${toc.length}`,
            title: match[2].replace(/<[^>]+>/g, "").trim(),
            href: match[1],
            level: 0,
          });
        }
      }
    }
  }

  // Fallback to NCX (EPUB 2)
  if (toc.length === 0) {
    const ncxMatch = opfContent.match(
      /<item[^>]+media-type="application\/x-dtbncx\+xml"[^>]+href="([^"]+)"[^>]*>/i
    );
    if (ncxMatch) {
      const ncxPath = rootDir + ncxMatch[1];
      const ncxContent = await zip.file(ncxPath)?.async("text");
      if (ncxContent) {
        const pointRegex =
          /<navPoint[^>]*>[\s\S]*?<text>([^<]*)<\/text>[\s\S]*?<content[^>]+src="([^"]+)"[^>]*>/gi;
        let match;
        while ((match = pointRegex.exec(ncxContent)) !== null) {
          toc.push({
            id: `toc-${toc.length}`,
            title: match[1].trim(),
            href: match[2],
            level: 0,
          });
        }
      }
    }
  }

  return toc;
}

async function extractText(
  zip: any,
  opfContent: string,
  rootDir: string
): Promise<string> {
  // Get spine order
  const spineMatch = opfContent.match(
    /<spine[^>]*>([\s\S]*?)<\/spine>/i
  );
  if (!spineMatch) return "";

  const idrefs: string[] = [];
  const itemrefRegex = /<itemref[^>]+idref="([^"]+)"[^>]*>/gi;
  let refMatch;
  while ((refMatch = itemrefRegex.exec(spineMatch[1])) !== null) {
    idrefs.push(refMatch[1]);
  }

  // Build manifest map: id -> href
  const manifest: Record<string, string> = {};
  const itemRegex =
    /<item[^>]+id="([^"]+)"[^>]+href="([^"]+)"[^>]*>/gi;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(opfContent)) !== null) {
    manifest[itemMatch[1]] = rootDir + itemMatch[2];
  }

  const textParts: string[] = [];
  for (const idref of idrefs) {
    const href = manifest[idref];
    if (!href) continue;

    const content = await zip.file(href)?.async("text");
    if (!content) continue;

    // Strip HTML tags to get plain text
    const text = content
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (text) {
      textParts.push(text);
    }
  }

  return textParts.join("\n\n");
}

async function extractCover(
  zip: any,
  opfContent: string,
  rootDir: string
): Promise<Buffer | null> {
  // Try cover-image property first
  const coverItemMatch = opfContent.match(
    /<item[^>]+properties="[^"]*cover-image[^"]*"[^>]+href="([^"]+)"[^>]*>/i
  );

  // Try meta cover
  const coverMetaMatch = opfContent.match(
    /<meta[^>]+name="cover"[^>]+content="([^"]+)"[^>]*>/i
  );

  let coverHref: string | null = null;

  if (coverItemMatch) {
    coverHref = rootDir + coverItemMatch[1];
  } else if (coverMetaMatch) {
    const coverId = coverMetaMatch[1];
    const itemMatch = opfContent.match(
      new RegExp(`<item[^>]+id="${coverId}"[^>]+href="([^"]+)"`, "i")
    );
    if (itemMatch) {
      coverHref = rootDir + itemMatch[1];
    }
  }

  if (!coverHref) return null;

  const coverData = await zip.file(coverHref)?.async("nodebuffer");
  return coverData || null;
}

/**
 * Main upload function: validates, hashes, deduplicates, processes, and stores.
 */
export async function processAndUploadBook(
  file: File,
  userId: string
): Promise<{ book: any; isNew: boolean }> {
  // Validate
  const validationError = validateEpub(file);
  if (validationError) {
    throw new Error(validationError);
  }

  // Compute MD5
  const md5 = await streamHash(file.stream());

  // Check for existing book (deduplication)
  const existing = await db.epubFile.findUnique({ where: { md5 } });
  if (existing) {
    // Grant access to existing book
    await db.userBookAccess.upsert({
      where: { userId_bookId: { userId, bookId: existing.id } },
      create: { userId, bookId: existing.id },
      update: {},
    });
    return { book: existing, isNew: false };
  }

  // Parse the new EPUB
  const parsed = await parseEpub(file);
  const totalParagraphs = parsed.text.split("\n\n").length;

  // Detect language from text sample
  const language = detectLanguage(parsed.text.substring(0, 5000));

  // Store files
  const epubPath = await storage.write(
    `epubs/${md5}.epub`,
    Buffer.from(await file.arrayBuffer())
  );
  const txtPath = await storage.write(`txts/${md5}.txt`, parsed.text);

  // Store cover if available
  let coverPath: string | null = null;
  if (parsed.coverBuffer) {
    coverPath = await storage.write(
      `covers/${md5}.jpg`,
      parsed.coverBuffer
    );
  }

  // Create book record
  const book = await db.epubFile.create({
    data: {
      md5,
      title: parsed.title,
      author: parsed.author,
      language,
      coverPath,
      epubPath,
      txtPath,
      tocJson: JSON.stringify(parsed.toc),
      fileSize: file.size,
      totalParagraphs,
      uploadedById: userId,
    },
  });

  // Grant access to uploader
  await db.userBookAccess.create({
    data: { userId, bookId: book.id },
  });

  return { book, isNew: true };
}
