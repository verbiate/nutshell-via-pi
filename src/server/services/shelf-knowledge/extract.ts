import { chunkText } from "@/lib/tts/chunk";
import { loadBookText } from "@/server/services/prompt-builder";
import { getCached, setCached } from "./cache";
import { completeJson } from "./llm-json";
import { slug } from "./render";
import type { OkfConcept } from "./types";

export type BookForm = "narrative" | "nonfiction" | "unknown";

export interface BookForExtraction {
  id: string;
  title: string;
  txtPath: string;
  bookMetadata: { isNarrative: boolean | null } | null;
}

export interface ExtractionResult {
  concepts: OkfConcept[];
  topic: string;
  form: BookForm;
}

// ponytail: the raw shape the LLM emits per chunk. sourceBookId/topic/form are
// OPTIONAL here because the model sometimes hallucinates them — the code stamps
// all three authoritatively (see extractBookConcepts), so any model-supplied
// value is ignored. bodyFields is Record<string,string> to match OkfConcept.
interface RawConcept {
  conceptType: string;
  title: string;
  bodyFields: Record<string, string>;
  relatedConceptNames: string[];
  sourceBookId?: unknown;
  topic?: unknown;
  form?: unknown;
}

interface ChunkResult {
  concepts: RawConcept[];
  topic: string;
  form?: BookForm;
}

// ─── Prompt templates (Task 11 tunes these) ─────────────────────────────────
// Each ends with "PASSAGE:" so the caller can append the chunk text verbatim.
// The JSON schema is identical across all three; only the concept vocabulary
// and the form-handling instruction differ.

export const NARRATIVE_PROMPT = `You are extracting concepts from a work of narrative fiction (a novel, story cycle, memoir, or narrative book).

From the PASSAGE below, extract the key narrative concepts that a reader would want to revisit and that other books on this shelf might echo. Return ONLY valid JSON matching this exact schema:

{
  "topic": "<2-4 word shelf topic this book belongs to, e.g. 'coming of age' or 'space exploration'>",
  "concepts": [
    {
      "conceptType": "character" | "theme" | "setting" | "plotArc" | "symbol",
      "title": "<concise canonical name>",
      "bodyFields": { "<FieldName>": "<value>" },
      "relatedConceptNames": ["<exact title of another concept in this book>"]
    }
  ]
}

Use these conceptType vocabularies and their bodyFields:
- character  → { "role": "...", "description": "...", "arc": "..." }
- theme      → { "description": "...", "expression": "where it shows up" }
- setting    → { "description": "...", "significance": "..." }
- plotArc    → { "summary": "...", "beats": "key turning points" }
- symbol     → { "meaning": "...", "occurrences": "..." }

Prefer fewer, well-supported concepts over many thin ones. Only include a concept if the passage clearly establishes it. Do not invent sourceBookId, topic, or form — those are stamped by the caller.

PASSAGE:
`;

export const NONFICTION_PROMPT = `You are extracting concepts from a nonfiction work (essay collection, textbook, treatise, investigative book, or exposition).

From the PASSAGE below, extract the key concepts a reader would want to revisit and that other books on this shelf might engage. Return ONLY valid JSON matching this exact schema:

{
  "topic": "<2-4 word shelf topic this book belongs to, e.g. 'cognitive science' or 'economic history'>",
  "concepts": [
    {
      "conceptType": "argument" | "framework" | "evidence" | "keyConcept" | "definition",
      "title": "<concise canonical name>",
      "bodyFields": { "<FieldName>": "<value>" },
      "relatedConceptNames": ["<exact title of another concept in this book>"]
    }
  ]
}

Use these conceptType vocabularies and their bodyFields:
- argument    → { "claim": "...", "support": "..." }
- framework   → { "description": "...", "components": "..." }
- evidence    → { "finding": "...", "method": "..." }
- keyConcept  → { "definition": "...", "significance": "..." }
- definition  → { "term": "...", "definition": "..." }

Prefer fewer, well-supported concepts over many thin ones. Only include a concept if the passage clearly establishes it. Do not invent sourceBookId, topic, or form — those are stamped by the caller.

PASSAGE:
`;

export const GENERIC_PROMPT = `You are extracting concepts from a book whose form is unknown — it may be narrative fiction or nonfiction.

FIRST, infer whether the PASSAGE below is primarily NARRATIVE (fiction/memoir/story) or NONFICTION (exposition/argument/reference). Then extract the concepts appropriate to that form and tag it.

Return ONLY valid JSON matching this exact schema:

{
  "topic": "<2-4 word shelf topic this book belongs to>",
  "form": "narrative" | "nonfiction",
  "concepts": [
    {
      "conceptType": "<see vocabularies below>",
      "title": "<concise canonical name>",
      "bodyFields": { "<FieldName>": "<value>" },
      "relatedConceptNames": ["<exact title of another concept in this book>"]
    }
  ]
}

If you inferred NARRATIVE, use these conceptTypes and bodyFields:
- character → { "role", "description", "arc" }
- theme     → { "description", "expression" }
- setting   → { "description", "significance" }
- plotArc   → { "summary", "beats" }
- symbol    → { "meaning", "occurrences" }

If you inferred NONFICTION, use these instead:
- argument   → { "claim", "support" }
- framework  → { "description", "components" }
- evidence   → { "finding", "method" }
- keyConcept → { "definition", "significance" }
- definition → { "term", "definition" }

The "form" field is REQUIRED — your inference backfills this book's classification. Prefer fewer, well-supported concepts over many thin ones. Do not invent sourceBookId or topic — those are stamped by the caller.

PASSAGE:
`;

const CHUNK_OPTS = { softLimit: 6000, hardLimit: 8000 };
const CACHE_NS = "extract";
// ponytail: cache-invalidation knob. Bump whenever the prompt text or the
// extracted schema changes — without it, prompt edits silently serve output
// extracted under the old prompt. isNarrative branch is also folded into the
// key so re-classifying a book (null→true) re-runs against the new branch.
const EXTRACT_PROMPT_VERSION = 1;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

export function isRawConcept(x: unknown): x is RawConcept {
  if (!isRecord(x)) return false;
  return (
    typeof x.conceptType === "string" &&
    typeof x.title === "string" &&
    isRecord(x.bodyFields) &&
    Object.values(x.bodyFields).every((v) => typeof v === "string") &&
    Array.isArray(x.relatedConceptNames) &&
    x.relatedConceptNames.every((n) => typeof n === "string")
  );
}

export function isChunkResult(x: unknown): x is ChunkResult {
  if (!isRecord(x)) return false;
  if (typeof x.topic !== "string") return false;
  if (!Array.isArray(x.concepts)) return false;
  if (!x.concepts.every(isRawConcept)) return false;
  if (x.form !== undefined && !["narrative", "nonfiction", "unknown"].includes(x.form as string)) {
    return false;
  }
  return true;
}

function choosePrompt(isNarrative: boolean | null): string {
  if (isNarrative === true) return NARRATIVE_PROMPT;
  if (isNarrative === false) return NONFICTION_PROMPT;
  return GENERIC_PROMPT;
}

function mostCommon(values: string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const c = counts.get(v)!;
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export async function extractBookConcepts(
  book: BookForExtraction,
): Promise<ExtractionResult> {
  const text = await loadBookText(book.txtPath);
  const chunks = chunkText(text, CHUNK_OPTS);
  const isNarrative = book.bookMetadata?.isNarrative ?? null;
  const prompt = choosePrompt(isNarrative);

  const results: ChunkResult[] = [];
  for (const chunk of chunks) {
    // ponytail: cache key = bookId + version + isNarrative branch + chunk.
    // Version + isNarrative are folded in so prompt/branch edits bust the
    // cache; without that, a tuned prompt would reuse the old branch's output.
    const cacheInput = `${book.id}\x00${EXTRACT_PROMPT_VERSION}\x00${isNarrative ?? "?"}\x00${chunk}`;
    const cached = await getCached<ChunkResult>(CACHE_NS, cacheInput);
    if (cached) {
      results.push(cached);
      continue;
    }
    const result = await completeJson({
      prompt: prompt + chunk,
      validate: isChunkResult,
    });
    await setCached(CACHE_NS, cacheInput, result);
    results.push(result);
  }

  // ponytail: book-level topic = plurality vote across per-chunk topics. The
  // LLM may phrase the topic slightly differently per chunk; the most common
  // phrasing wins. Falls back to "unknown" only if every chunk was empty.
  const bookTopic = mostCommon(results.map((r) => r.topic)) ?? "unknown";

  // ponytail: form comes from metadata when known; otherwise it's the model's
  // inference (plurality across chunks). This backfills the unclassified books.
  let form: BookForm;
  if (isNarrative === true) form = "narrative";
  else if (isNarrative === false) form = "nonfiction";
  else {
    const inferred = mostCommon(results.map((r) => r.form ?? "unknown")) ?? "unknown";
    form = inferred === "narrative" || inferred === "nonfiction" ? inferred : "unknown";
  }

  // Merge concepts across chunks; dedupe by slug(title). On collision, keep the
  // first and union bodyFields (later wins on key conflict) + relatedConceptNames.
  const bySlug = new Map<string, OkfConcept>();
  for (const raw of results.flatMap((r) => r.concepts)) {
    const s = slug(raw.title);
    // ponytail: stamp sourceBookId/topic/form OURSELVES — never trust the LLM
    // for book identity or shelf grouping. A hallucinated sourceBookId would
    // orphan the concept from its book in the rendered wiki; a hallucinated
    // topic would mis-file it on the shelf.
    const concept: OkfConcept = {
      conceptType: raw.conceptType,
      title: raw.title,
      bodyFields: { ...raw.bodyFields },
      relatedConceptNames: [...raw.relatedConceptNames],
      sourceBookId: book.id,
      topic: bookTopic,
      form,
    };
    const existing = bySlug.get(s);
    if (!existing) {
      bySlug.set(s, concept);
      continue;
    }
    existing.bodyFields = { ...existing.bodyFields, ...concept.bodyFields };
    for (const n of concept.relatedConceptNames) {
      if (!existing.relatedConceptNames.includes(n)) {
        existing.relatedConceptNames.push(n);
      }
    }
  }

  return { concepts: [...bySlug.values()], topic: bookTopic, form };
}
