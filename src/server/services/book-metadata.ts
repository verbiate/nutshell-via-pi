import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import { fillTemplate } from "./prompt-builder";
import {
  completeChat,
  getOpenRouterConfig,
  OpenRouterError,
} from "./openrouter";
import { getSetting } from "./settings";

// ponytail: AppSetting key for the model override. When null/missing, the
// admin-tier model from the API Keys & Models page is used.
export const BOOK_METADATA_MODEL_KEY = "bookMetadataModel";

export async function getBookMetadataModel(): Promise<string | null> {
  return getSetting(BOOK_METADATA_MODEL_KEY);
}

// ponytail: mirror the explainer's size guard. 900k tokens * ~4 chars/token.
const MAX_BOOK_CHARS = 900_000 * 4;

export interface ExtractedBookMetadata {
  title: string;
  subtitle: string | null;
  description: string | null;
  author: string | null;
  authorGender: string | null;
  isNarrative: boolean | null;
  language: string | null;
}

// Fields the admin can revert to the OPF originals on EpubFile. The three new
// fields (subtitle/authorGender/isNarrative) have no OPF source so they aren't
// in this union — revert clears them.
export type RevertableField = "title" | "author" | "language";

export interface GenerationTiming {
  generationMs: number;
  model: string;
  extractedAt: string;
}

export interface BookMetadataView {
  epub: {
    title: string;
    author: string | null;
    language: string;
  };
  metadata: {
    id: string;
    title: string;
    subtitle: string | null;
    description: string | null;
    author: string | null;
    authorGender: string | null;
    isNarrative: boolean | null;
    language: string | null;
    promptVersion: number;
    extractionCount: number;
    model: string | null;
    extractedAt: string;
    updatedAt: string;
    fastestGeneration: GenerationTiming | null;
    latestGeneration: GenerationTiming | null;
  } | null;
}

export async function getExtractionCount(bookId: string): Promise<number> {
  return db.auditLog.count({
    where: {
      action: "BOOK_METADATA_EXTRACTED",
      entityType: "BookMetadata",
      entityId: bookId,
    },
  });
}

// ponytail: one scan of the audit log returns both fastest and latest
// generation timing. generationMs is stashed in each entry's newValue JSON
// (see doExtractBookMetadata). Entries ordered desc by createdAt so the
// first valid entry is the latest. Old entries without timing are skipped.
export async function getGenerationStats(
  bookId: string
): Promise<{ fastest: GenerationTiming | null; latest: GenerationTiming | null }> {
  const entries = await db.auditLog.findMany({
    where: {
      action: "BOOK_METADATA_EXTRACTED",
      entityType: "BookMetadata",
      entityId: bookId,
    },
    select: { newValue: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  let fastest: GenerationTiming | null = null;
  let latest: GenerationTiming | null = null;

  for (const entry of entries) {
    if (!entry.newValue) continue;
    try {
      const parsed = JSON.parse(entry.newValue);
      if (typeof parsed.generationMs !== "number") continue;
      const timing: GenerationTiming = {
        generationMs: parsed.generationMs,
        model: parsed.model ?? "unknown",
        extractedAt: entry.createdAt.toISOString(),
      };
      if (!latest) latest = timing;
      if (!fastest || timing.generationMs < fastest.generationMs) {
        fastest = timing;
      }
    } catch {
      continue;
    }
  }
  return { fastest, latest };
}

export async function getBookMetadataView(
  bookId: string
): Promise<BookMetadataView | null> {
  const book = await db.epubFile.findUnique({
    where: { id: bookId },
    select: { title: true, author: true, language: true, bookMetadata: true },
  });
  if (!book) return null;
  const [extractionCount, genStats] = await Promise.all([
    getExtractionCount(bookId),
    getGenerationStats(bookId),
  ]);
  return {
    epub: {
      title: book.title,
      author: book.author,
      language: book.language,
    },
    metadata: book.bookMetadata
      ? {
          id: book.bookMetadata.id,
          title: book.bookMetadata.title,
          subtitle: book.bookMetadata.subtitle,
          description: book.bookMetadata.description,
          author: book.bookMetadata.author,
          authorGender: book.bookMetadata.authorGender,
          isNarrative: book.bookMetadata.isNarrative,
          language: book.bookMetadata.language,
          promptVersion: book.bookMetadata.promptVersion,
          extractionCount,
          model: book.bookMetadata.model,
          extractedAt: book.bookMetadata.extractedAt.toISOString(),
          updatedAt: book.bookMetadata.updatedAt.toISOString(),
          fastestGeneration: genStats.fastest,
          latestGeneration: genStats.latest,
        }
      : null,
  };
}

// ponytail: in-flight dedup. StrictMode (dev) double-fires effects, HMR
// re-fires them, two users can open the same stray book simultaneously, etc.
// Concurrent callers for the same book join the same promise instead of
// starting parallel LLM calls. Module-scoped — does not persist across server
// restarts or work across processes (fine for this single-node deployment).
// Cleared via .finally so the Map can't grow unbounded.
const extractionInFlight = new Map<string, Promise<ExtractedBookMetadata>>();

export async function extractBookMetadata(
  bookId: string,
  actorId: string,
  opts: { force?: boolean } = {}
): Promise<ExtractedBookMetadata> {
  // ponytail: forced re-extract (admin "Re-extract" button) bypasses both
  // short-circuits — admin wants a fresh LLM call regardless of what's in
  // the DB or what's in flight. Reader-side ensure-metadata uses the default
  // (force=false) so it's idempotent: completed row → return; in-flight → join.
  if (!opts.force) {
    // Fast path — completed row exists.
    const existing = await db.bookMetadata.findUnique({
      where: { bookId },
      select: {
        title: true,
        subtitle: true,
        description: true,
        author: true,
        authorGender: true,
        isNarrative: true,
        language: true,
      },
    });
    if (existing) return existing as ExtractedBookMetadata;

    // Dedupe concurrent callers — second caller joins the first's in-flight
    // promise rather than firing a second LLM request.
    const pending = extractionInFlight.get(bookId);
    if (pending) return pending;
  }

  // Start new extraction; register in Map so concurrent non-forced callers
  // join this promise instead of starting their own. A forced call overwrites
  // any pre-existing entry — admin's intent wins. The orphaned promise (if
  // any) still completes and upserts; last write wins on the row.
  const promise = doExtractBookMetadata(bookId, actorId).finally(() =>
    extractionInFlight.delete(bookId)
  );
  extractionInFlight.set(bookId, promise);
  return promise;
}

async function doExtractBookMetadata(
  bookId: string,
  actorId: string
): Promise<ExtractedBookMetadata> {
  const book = await db.epubFile.findUnique({ where: { id: bookId } });
  if (!book) throw new OpenRouterError("Book not found", 404);
  if (!book.txtPath) throw new OpenRouterError("Book has no plaintext path", 400);

  const template = await db.promptTemplate.findUnique({
    where: { type: "book_metadata" },
  });
  if (!template)
    throw new OpenRouterError("Book metadata template not found", 500);

  const fullText = (await storage.read(book.txtPath)).toString("utf-8");
  if (fullText.length > MAX_BOOK_CHARS) {
    throw new OpenRouterError(
      `Book too large for metadata extraction (${fullText.length} chars; limit ${MAX_BOOK_CHARS})`,
      400
    );
  }

  const prompt = fillTemplate(template.content, { book_text: fullText });

  // ponytail: API key always comes from the admin-tier config (OpenRouter
  // uses one key for all models). The model slug is overridable per-app via
  // the bookMetadataModel AppSetting so admins can pick e.g. Sonnet for JSON
  // while keeping Flash as the playground default.
  const { apiKey, model: defaultModel } = await getOpenRouterConfig("admin");
  const model = (await getBookMetadataModel()) ?? defaultModel;
  if (!apiKey)
    throw new OpenRouterError("Admin OpenRouter API key not configured", 500);

  // ponytail: 0.7 so Re-extract can produce varied metadata for the same
  // book. Flash Lite is effectively deterministic below ~0.5 for JSON tasks.
  // Retry once on failure — temp=0.7 can occasionally produce malformed JSON
  // or trigger transient OpenRouter errors. generationMs measures only the
  // successful attempt so timing comparisons stay fair.
  let parsed: ExtractedBookMetadata | null = null;
  let generationMs = 0;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
    try {
      const start = Date.now();
      const raw = await completeChat({
        apiKey,
        model,
        prompt,
        temperature: 0.7,
        // ponytail: reasoning models (e.g. gemini-3.5-flash) burn ~1000
        // tokens on internal reasoning before emitting JSON. 1024 maxTokens
        // truncates the output mid-JSON → "LLM did not return JSON".
        // 4096 leaves room for reasoning + the small JSON metadata object.
        maxTokens: 4096,
        jsonMode: true,
      });
      generationMs = Date.now() - start;
      parsed = safeParseMetadata(raw);
    } catch (e) {
      lastError = e;
      console.error(
        `[book-metadata] attempt ${attempt} failed for ${bookId}:`,
        e instanceof Error ? e.message : e
      );
    }
  }
  if (!parsed) throw lastError;

  const previous = await db.bookMetadata.findUnique({ where: { bookId } });
  const row = await db.bookMetadata.upsert({
    where: { bookId },
    create: {
      bookId,
      ...parsed,
      promptVersion: template.version,
      model,
    },
    update: {
      ...parsed,
      promptVersion: template.version,
      model,
      extractedAt: new Date(),
    },
  });

  // ponytail: generationMs in newValue (not on the row) so the audit log
  // carries timing per extraction without a schema migration. Read back by
  // getFastestGeneration to surface the fastest model in the admin UI.
  await db.auditLog.create({
    data: {
      actorId,
      action: "BOOK_METADATA_EXTRACTED",
      entityType: "BookMetadata",
      entityId: bookId,
      oldValue: previous ? JSON.stringify(previous) : null,
      newValue: JSON.stringify({ ...row, generationMs }),
    },
  });

  return parsed;
}

export async function revertBookMetadataField(
  bookId: string,
  field: RevertableField,
  actorId: string
): Promise<void> {
  const book = await db.epubFile.findUnique({
    where: { id: bookId },
    select: { title: true, author: true, language: true, bookMetadata: true },
  });
  if (!book) throw new OpenRouterError("Book not found", 404);
  if (!book.bookMetadata)
    throw new OpenRouterError("No extracted metadata to revert", 400);

  // ponytail: copy the OPF original back into the BookMetadata row so it
  // remains the canonical display source. EpubFile is never mutated.
  const epubValue =
    field === "title" ? book.title : field === "author" ? book.author : book.language;

  const oldValue = (() => {
    const m = book.bookMetadata;
    return field === "title"
      ? m.title
      : field === "author"
        ? m.author
        : m.language;
  })();

  await db.bookMetadata.update({
    where: { bookId },
    data: { [field]: epubValue },
  });

  await db.auditLog.create({
    data: {
      actorId,
      action: "BOOK_METADATA_REVERTED",
      entityType: "BookMetadata",
      entityId: bookId,
      oldValue: JSON.stringify({ field, value: oldValue }),
      newValue: JSON.stringify({ field, value: epubValue }),
    },
  });
}

function safeParseMetadata(raw: string): ExtractedBookMetadata {
  // Try strict JSON first; fall back to extracting the first {...} block.
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new OpenRouterError("LLM did not return JSON", 500);
    try {
      obj = JSON.parse(match[0]);
    } catch {
      throw new OpenRouterError("LLM returned malformed JSON", 500);
    }
  }

  const title = typeof obj.title === "string" ? obj.title : "";
  if (!title) throw new OpenRouterError("LLM JSON missing title", 500);

  return {
    title,
    subtitle: asStringOrNull(obj.subtitle),
    description: asStringOrNull(obj.description),
    author: asStringOrNull(obj.author),
    authorGender: asStringOrNull(obj.authorGender),
    isNarrative:
      obj.isNarrative === true
        ? true
        : obj.isNarrative === false
          ? false
          : null,
    language: asStringOrNull(obj.language),
  };
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
