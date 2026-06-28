import crypto from "crypto";
import { storage } from "@/server/storage/local";
import { db } from "@/server/db";
import { detectLanguage } from "@/lib/language";
import { countTokens } from "@/server/services/tokens";
import { getTierBookTokenLimit } from "@/server/services/model-info";
import { recordError } from "@/server/services/errors";
import { extractBookMetadata } from "@/server/services/book-metadata";

// ponytail: custom error so the upload route can return 413 (not 500) when
// the user's tier can't accommodate the book. Message is intentionally
// token-jargon-free per the user's UX direction.
export class UploadBlockedError extends Error {
  statusCode = 413;
  constructor() {
    super("This book is too large for your current tier.");
    this.name = "UploadBlockedError";
  }
}

export interface ParsedEpub {
  title: string;
  author: string | null;
  text: string;
  toc: TocEntry[];
  coverBuffer: Buffer | null;
  coverMediaType: string | null;
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
  const cover = await extractCover(zip, opfContent, rootDir);

  return {
    title,
    author,
    text,
    toc,
    coverBuffer: cover.buffer,
    coverMediaType: cover.mediaType,
  };
}

async function extractToc(
  zip: any,
  opfContent: string,
  rootDir: string
): Promise<TocEntry[]> {
  const toc: TocEntry[] = [];

  // Try EPUB 3 nav document first
  const navItem = parseManifest(opfContent).find((it) =>
    /\bnav\b/.test(it.properties || "")
  );
  if (navItem) {
    const navPath = rootDir + navItem.href;
    const navContent = await zip.file(navPath)?.async("text");
    if (navContent) {
      const tocMatch = navContent.match(
        /<nav[^>]+epub:type="toc"[^>]*>([\s\S]*?)<\/nav>/i
      ) || navContent.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
      if (tocMatch) {
        const linkRegex =
          /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
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
    const ncxItem = parseManifest(opfContent).find(
      (it) => it.mediaType === "application/x-dtbncx+xml"
    );
    if (ncxItem) {
      const ncxPath = rootDir + ncxItem.href;
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
  for (const item of parseManifest(opfContent)) {
    manifest[item.id] = rootDir + item.href;
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

function getAttr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"', "i"));
  return m ? m[1] : null;
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string | null;
  properties: string | null;
}

function parseManifest(opfContent: string): ManifestItem[] {
  const tags = opfContent.match(/<item\b[^>]*>/gi) || [];
  return tags
    .map((t) => ({
      id: getAttr(t, "id"),
      href: getAttr(t, "href"),
      mediaType: getAttr(t, "media-type"),
      properties: getAttr(t, "properties"),
    }))
    .filter((it) => it.id && it.href) as ManifestItem[];
}

async function extractCover(
  zip: any,
  opfContent: string,
  rootDir: string
): Promise<{ buffer: Buffer | null; mediaType: string | null }> {
  const itemTags = opfContent.match(/<item\b[^>]*>/gi) || [];

  let coverTag: string | null = null;

  for (const tag of itemTags) {
    if (/\bcover-image\b/.test(getAttr(tag, "properties") || "")) {
      coverTag = tag;
      break;
    }
  }

  if (!coverTag) {
    const coverMeta = (opfContent.match(/<meta\b[^>]*>/gi) || []).find(
      (t) => getAttr(t, "name") === "cover"
    );
    const coverId = coverMeta ? getAttr(coverMeta, "content") : null;
    if (coverId) {
      coverTag = itemTags.find((t) => getAttr(t, "id") === coverId) || null;
    }
  }

  const href = coverTag ? getAttr(coverTag, "href") : null;
  if (!coverTag || !href) return { buffer: null, mediaType: null };

  const mediaType = getAttr(coverTag, "media-type");
  const coverData = await zip.file(rootDir + href)?.async("nodebuffer");
  return { buffer: coverData || null, mediaType: mediaType || null };
}

function coverExtension(mediaType: string | null): string {
  switch ((mediaType || "").toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/svg+xml":
      return ".svg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    default:
      return ".jpg";
  }
}

/**
 * Main upload function: validates, hashes, deduplicates, processes, and stores.
 */
export async function processAndUploadBook(
  file: File,
  userId: string,
  userRole: string = "regular"
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
    // ponytail: stray-book path. The original upload may predate auto-extract;
    // if metadata is missing, fire-and-forget now. Short-circuits inside the
    // service if a row already exists (e.g. upload race with another reader).
    triggerMetadataExtraction(existing.id, userId);
    return { book: existing, isNew: false };
  }

  // Parse the new EPUB
  const parsed = await parseEpub(file);
  const totalParagraphs = parsed.text.split("\n\n").length;

  // Detect language from text sample
  const language = detectLanguage(parsed.text.substring(0, 5000));

  // Tokenize plaintext (cl100k_base) for context-window accounting in the
  // admin playground. Computed once at upload; expensive for very large books
  // (~100ms for 1MB) but a one-time cost.
  const txtTokens = countTokens(parsed.text);

  // ponytail: tier-aware size check BEFORE storing anything. Resolves the
  // limit via the chain: admin override → model context_length → 128K fallback.
  // Throws UploadBlockedError if exceeded; the route returns 413 with a
  // friendly (token-jargon-free) message. Records a SystemError so admins see
  // the block. Existing books (dedup hits) bypass this check — already in.
  const tierLimit = await getTierBookTokenLimit(userRole);
  if (txtTokens > tierLimit) {
    await recordError({
      category: "upload_blocked",
      message: `Upload blocked: book token count (${txtTokens}) exceeds tier limit (${tierLimit})`,
      userId,
      context: {
        tier: userRole,
        txtTokens,
        tierLimit,
        fileSize: file.size,
        title: parsed.title,
      },
    });
    throw new UploadBlockedError();
  }

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
      `covers/${md5}${coverExtension(parsed.coverMediaType)}`,
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
      txtTokens,
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

  // ponytail: fire-and-forget background extraction. Never blocks the upload
  // response; failures land in the admin Errors log via recordError. The
  // reader-side ensure-metadata endpoint also triggers as a fallback if the
  // user opens the book before this completes (the service short-circuits
  // when a row already exists, so duplicate work is bounded).
  triggerMetadataExtraction(book.id, userId);

  return { book, isNew: true };
}

// ponytail: detached promise wrapper. Keeps processAndUploadBook readable and
// guarantees a single .catch() path that records to SystemError. The shelf
// wiki rebuild chains onto metadata resolution via .then(): it needs
// bookMetadata.isNarrative to route the prompt branch, so it must wait.
// Rebuild is fire-and-forget too — upload response never blocks. Wiki cache
// makes this ~1 new extraction call per upload (existing books/themes are
// cache hits); if a wiki rebuild ever becomes expensive, add an incremental
// path in build-wiki rather than here.
function triggerMetadataExtraction(bookId: string, userId: string): void {
  void extractBookMetadata(bookId, userId)
    .then(() => {
      void rebuildShelfWiki().catch(async (err: unknown) => {
        await recordError({
          category: "shelf_wiki_rebuild_failed",
          message: err instanceof Error ? err.message : String(err),
          userId,
          bookId,
        });
      });
    })
    .catch(async (err: unknown) => {
      await recordError({
        category: "metadata_extraction_failed",
        message: err instanceof Error ? err.message : String(err),
        userId,
        bookId,
      });
    });
}

// ponytail: thin local wrapper — lazy import so the wiki module isn't loaded
// at upload time, matching the codebase's dynamic-import convention.
async function rebuildShelfWiki(): Promise<void> {
  const { build } = await import("./shelf-knowledge/build-wiki");
  await build();
}
