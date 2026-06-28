import crypto from "node:crypto";
import { loadBookText } from "@/server/services/prompt-builder";
import { getCached, setCached } from "./cache";
import { completeJson } from "./llm-json";
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

// ponytail: the raw shape the LLM emits for the whole book. sourceBookId/topic
// are OPTIONAL here because the model sometimes hallucinates them — the code
// stamps both authoritatively (see extractBookConcepts), so any model-supplied
// value is ignored. form is OPTIONAL except in the generic template where it
// is REQUIRED (used to backfill null-metadata books).
interface RawConcept {
  conceptType: string;
  title: string;
  bodyFields: Record<string, string>;
  relatedConceptNames: string[];
  sourceBookId?: unknown;
  topic?: unknown;
  form?: unknown;
}

interface BookResult {
  topic: string;
  form?: BookForm;
  concepts: RawConcept[];
}

// ─── Prompt templates (whole-book framing) ──────────────────────────────────
// Each ends with "BOOK TEXT:\n" so the caller appends the FULL book text in one
// pass. The JSON schema is identical across all three; only the concept
// vocabulary and the form-handling instruction differ. Long-context models
// (gemini-3.5-flash, 1M context) read the entire book and emit one coherent,
// book-level concept set — no chunking, no per-passage fragments.

export const NARRATIVE_PROMPT = `You are extracting concepts from a work of narrative fiction (a novel, story cycle, memoir, or narrative book).

Read the ENTIRE BOOK below in full and extract its ~10-12 MOST IMPORTANT, book-level concepts — the characters, themes, settings, plot arcs, and symbols a reader would revisit and that other books on this shelf might echo. These must be coherent whole-book concepts, not passage-local mentions.

Return ONLY valid JSON matching this exact schema:

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

Aim for ~10-12 concepts — this is a HARD CAP: never exceed 12. Each concept must be significant enough that a reader would revisit it; skip minor mentions. Quality over quantity. Keep every bodyField value to ONE sentence (max ~25 words). Cross-reference related concepts via relatedConceptNames using the EXACT title of another concept in this book. Do not invent sourceBookId, topic, or form — those are stamped by the caller.

BOOK TEXT:
`;

export const NONFICTION_PROMPT = `You are extracting concepts from a nonfiction work (essay collection, textbook, treatise, investigative book, or exposition).

Read the ENTIRE BOOK below in full and extract its ~10-12 MOST IMPORTANT, book-level concepts — the arguments, frameworks, evidence, key concepts, and definitions a reader would want to revisit and that other books on this shelf might engage. These must be coherent whole-book concepts, not passage-local mentions.

Return ONLY valid JSON matching this exact schema:

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

Aim for ~10-12 concepts — this is a HARD CAP: never exceed 12. Each concept must be significant enough that a reader would revisit it; skip minor mentions. Quality over quantity. Keep every bodyField value to ONE sentence (max ~25 words). Cross-reference related concepts via relatedConceptNames using the EXACT title of another concept in this book. Do not invent sourceBookId, topic, or form — those are stamped by the caller.

BOOK TEXT:
`;

export const GENERIC_PROMPT = `You are extracting concepts from a book whose form is unknown — it may be narrative fiction or nonfiction.

FIRST, read the ENTIRE BOOK below in full and infer whether it is primarily NARRATIVE (fiction/memoir/story) or NONFICTION (exposition/argument/reference). Then extract its ~10-12 MOST IMPORTANT, book-level concepts appropriate to that form — the kind a reader would revisit and that other books on this shelf might engage. These must be coherent whole-book concepts, not passage-local mentions.

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

The "form" field is REQUIRED — your inference backfills this book's classification. Aim for ~10-12 concepts — HARD CAP, never exceed 12. Each concept must be significant enough that a reader would revisit it; skip minor mentions. Quality over quantity. Keep every bodyField value to ONE sentence (max ~25 words). Cross-reference related concepts via relatedConceptNames using the EXACT title of another concept in this book. Do not invent sourceBookId or topic — those are stamped by the caller.

BOOK TEXT:
`;

const CACHE_NS = "extract";
// ponytail: cache-invalidation knob. Bump whenever the prompt text or the
// extracted schema changes — without it, prompt edits silently serve output
// extracted under the old prompt. v5: chunked → whole-book extraction; the
// approach fundamentally changed so a clean version reflects that.
const EXTRACT_PROMPT_VERSION = 5;

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

export function isBookResult(x: unknown): x is BookResult {
  // ponytail: only validates the OUTER shape ({topic, concepts: array}). Individual
  // concepts are filtered separately in extractBookConcepts — a lite model occasionally
  // emits one malformed concept, and rejecting the whole book for it would scrap
  // 9 good concepts. The filter keeps the valid ones.
  if (!isRecord(x)) return false;
  if (typeof x.topic !== "string") return false;
  if (!Array.isArray(x.concepts)) return false;
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

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function extractBookConcepts(
  book: BookForExtraction,
): Promise<ExtractionResult> {
  const text = await loadBookText(book.txtPath);
  const isNarrative = book.bookMetadata?.isNarrative ?? null;

  // ponytail: per-book cache key = bookId + version + text-hash. Text hash
  // handles re-upload (same bookId, different content → re-extract); bookId +
  // version for hygiene. isNarrative is folded into the prompt choice, but
  // not the key — a re-classified null→known book would re-extract via the
  // version bump that ships with such a change.
  const cacheInput = `${book.id}\x00${EXTRACT_PROMPT_VERSION}\x00${sha256Hex(text).slice(0, 16)}`;
  const cached = await getCached<BookResult>(CACHE_NS, cacheInput);
  if (cached) return materialize(book, cached, isNarrative);

  const prompt = choosePrompt(isNarrative);
  const result = await completeJson<BookResult>({
    prompt: prompt + text,
    validate: isBookResult,
    // ponytail: extraction is mechanical — minimal reasoning avoids burning the
    // output budget on hidden thinking. 16k headroom for ~12 verbose concepts.
    reasoningEffort: "minimal",
    maxTokens: 16384,
  });
  // ponytail: drop malformed concepts (lite model occasionally emits one) rather
  // than failing the whole book; then hard-cap to 12 (prompt cap is soft).
  const valid = result.concepts.filter(isRawConcept);
  const capped = { ...result, concepts: valid.slice(0, 12) };
  await setCached(CACHE_NS, cacheInput, capped);
  return materialize(book, capped, isNarrative);
}

// ponytail: stamps sourceBookId + topic authoritatively and resolves form from
// metadata when known; otherwise trusts the model's inference (backfill). One
// coherent concept set per book → no merge/dedupe (unlike the old chunk loop).
function materialize(
  book: BookForExtraction,
  result: BookResult,
  isNarrative: boolean | null,
): ExtractionResult {
  const topic = result.topic;
  let form: BookForm;
  if (isNarrative === true) form = "narrative";
  else if (isNarrative === false) form = "nonfiction";
  else {
    const inferred = result.form ?? "unknown";
    form = inferred === "narrative" || inferred === "nonfiction" ? inferred : "unknown";
  }
  const concepts: OkfConcept[] = result.concepts.map((raw) => ({
    conceptType: raw.conceptType,
    title: raw.title,
    bodyFields: { ...raw.bodyFields },
    relatedConceptNames: [...raw.relatedConceptNames],
    // ponytail: never trust the LLM for book identity or shelf grouping. A
    // hallucinated sourceBookId would orphan the concept from its book in the
    // rendered wiki; a hallucinated topic would mis-file it on the shelf.
    sourceBookId: book.id,
    topic,
    form,
  }));
  return { concepts, topic, form };
}
