import crypto from "node:crypto";
import { db } from "@/server/db";
import { getCached, setCached } from "./cache";
import { completeJson } from "./llm-json";
import { readWikiFile } from "./wiki-storage";

// ponytail: two cached LLM calls over the compiled wiki — navigate (which
// concepts) then read+answer. Access is enforced at the index filter AND again
// at read time (defense in depth): an inaccessible concept can never reach the
// answer prompt even if the nav step or cache were somehow bypassed.

const NAV_NS = "query-nav";
const ANSWER_NS = "query-answer";
// ponytail: cap selected concepts to bound read IO + answer context. Raise if
// answers regularly need >5 concepts to ground.
const MAX_CONCEPTS = 5;
// ponytail: cache-invalidation knob — bump when either prompt text changes.
// Without it, prompt edits silently serve stale answers.
export const QUERY_PROMPT_VERSION = 1;

const FALLBACK_NO_ACCESS =
  "I couldn't find any relevant concepts in books you have access to for that.";
const FALLBACK_NOTHING_FOUND =
  "I couldn't find relevant concepts in your library for that question.";

export interface ShelfCitation {
  bookId: string;
  bookTitle: string;
  conceptTitle: string;
}

export interface ShelfAnswer {
  prompt: string;
  sourceText: string;
  bookText: string;
  bookMd5: string;
  promptVersion: number;
  citations: ShelfCitation[];
}

interface NavResult {
  conceptRelPaths: string[];
}
interface AnswerResult {
  answer: string;
}

interface IndexEntry {
  relPath: string;
  title: string;
  desc: string;
}
interface LoadedConcept {
  relPath: string;
  title: string;
  bookId: string;
  body: string;
}

// ponytail: sorted-join so access-set order never fragments the cache key or
// the synthetic bookMd5. Mirrors synthesize.ts's sorted-bookIds approach.
function accessHash(ids: string[]): string {
  return crypto
    .createHash("sha256")
    .update([...ids].sort().join(","))
    .digest("hex");
}

// ponytail: relPath is the canonical concept id (render.ts:20). The bookId
// segment is the access key — simpler + more robust than parsing frontmatter.
function bookIdOfRelPath(rel: string): string | null {
  const m = rel.match(/^concepts\/([^/]+)\//);
  return m ? m[1] : null;
}

// ponytail: parse the concept lines render.ts:120 emits:
//   - [Title](concepts/<bookId>/<slug>.md) — desc
// Themes/book headers (no concepts/ href) are ignored.
function parseIndexConcepts(indexMd: string): IndexEntry[] {
  const re =
    /^\s*- \[([^\]]+)\]\((concepts\/[^)]+\.md)\)(?:\s*[—–-]\s*(.*))?$/gm;
  const out: IndexEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(indexMd)) !== null) {
    out.push({ title: m[1], relPath: m[2], desc: (m[3] ?? "").trim() });
  }
  return out;
}

// ponytail: render.ts:24 yamlStr escapes only \ and ". Reverse exactly that.
function unescapeYaml(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

const TITLE_RE = /^title:\s*"((?:\\.|[^"\\])*)"/m;
function parseTitle(body: string, fallback: string): string {
  const m = body.match(TITLE_RE);
  return m ? unescapeYaml(m[1]) : fallback;
}

function buildNavPrompt(question: string, entries: IndexEntry[]): string {
  const listing = entries
    .map((e) => `- [${e.relPath}] ${e.title}${e.desc ? ` — ${e.desc}` : ""}`)
    .join("\n");
  return `You are navigating the user's library knowledge base to find concepts relevant to their question.

Available concepts (only from books the user has access to):
${listing}

User question: ${question}

Return ONLY valid JSON matching this schema:
{
  "conceptRelPaths": ["<a path from the list above>"]
}

Constraints:
- Every conceptRelPath MUST be one of the exact paths listed above — do not invent or alter them.
- Pick only concepts relevant to answering the question.
- Select at most ${MAX_CONCEPTS}.
- If none are relevant, return an empty array.`;
}

// ponytail: type guard closes over the accessible known set so any invented or
// inaccessible relPath is rejected — completeJson retries once on rejection.
function makeNavValidator(
  known: Set<string>,
): (x: unknown) => x is NavResult {
  return (x: unknown): x is NavResult => {
    if (typeof x !== "object" || x === null) return false;
    const r = x as Record<string, unknown>;
    if (!Array.isArray(r.conceptRelPaths)) return false;
    return r.conceptRelPaths.every(
      (p) => typeof p === "string" && known.has(p),
    );
  };
}

function buildAnswerPrompt(
  question: string,
  concepts: LoadedConcept[],
): string {
  const blocks = concepts
    .map((c) => `## ${c.title} (from ${c.bookId})\n${c.body}`)
    .join("\n\n");
  return `Answer the user's question using ONLY the provided concept excerpts from their library knowledge base.

User question: ${question}

Concept excerpts:
${blocks}

Answer using ONLY the information in these excerpts. If they do not contain the answer, say so plainly. Do not use outside knowledge.

Return ONLY valid JSON matching this schema:
{ "answer": "<your grounded answer>" }`;
}

function isAnswerResult(x: unknown): x is AnswerResult {
  if (typeof x !== "object" || x === null) return false;
  const a = (x as Record<string, unknown>).answer;
  return typeof a === "string" && a.length > 0;
}

export async function answerShelfQuestion(args: {
  question: string;
  accessibleBookIds: string[];
}): Promise<ShelfAnswer> {
  const access = new Set(args.accessibleBookIds);
  const hash = accessHash(args.accessibleBookIds);
  const bookMd5 = `shelf:${hash}`;

  // Step 0: read index, filter to accessible concepts (LAYER 1).
  let indexMd = "";
  try {
    indexMd = await readWikiFile("index.md");
  } catch {
    // Wiki not built / unreadable → treat as empty index. ContextSourceStrategy
    // .isReady() is the real gate; reaching here unanswered is a graceful no-op.
    indexMd = "";
  }
  const filteredEntries = parseIndexConcepts(indexMd).filter((e) => {
    const bid = bookIdOfRelPath(e.relPath);
    return bid !== null && access.has(bid);
  });

  if (filteredEntries.length === 0) {
    return emptyAnswer(bookMd5, FALLBACK_NO_ACCESS);
  }
  const knownPaths = new Set(filteredEntries.map((e) => e.relPath));

  // Step 1: navigate — which concept files to read (cached by question+access).
  const navInput = `${args.question}\x00${hash}`;
  const cachedNav = await getCached<NavResult>(NAV_NS, navInput);
  let selected: string[];
  if (cachedNav) {
    // ponytail: re-validate against the current known set — access may have
    // changed since the nav result was cached.
    selected = cachedNav.conceptRelPaths.filter((p) => knownPaths.has(p));
  } else {
    const nav = await completeJson({
      prompt: buildNavPrompt(args.question, filteredEntries),
      validate: makeNavValidator(knownPaths),
    });
    selected = nav.conceptRelPaths;
    await setCached(NAV_NS, navInput, { conceptRelPaths: selected });
  }
  selected = selected.slice(0, MAX_CONCEPTS);

  if (selected.length === 0) {
    return emptyAnswer(bookMd5, FALLBACK_NOTHING_FOUND);
  }

  // Step 2: defense-in-depth filter at read time (LAYER 2) — drop any path whose
  // bookId is not accessible, even if nav/cache handed it to us.
  const accessibleSelected = selected.filter((p) => {
    const bid = bookIdOfRelPath(p);
    return bid !== null && access.has(bid);
  });
  if (accessibleSelected.length === 0) {
    return emptyAnswer(bookMd5, FALLBACK_NOTHING_FOUND);
  }

  // Step 3: read the selected concept files.
  const loaded: LoadedConcept[] = [];
  for (const rel of accessibleSelected) {
    const body = await readWikiFile(rel);
    const bookId = bookIdOfRelPath(rel)!; // safe: accessibleSelected only contains matching relPaths
    const title = parseTitle(body, rel);
    loaded.push({ relPath: rel, title, bookId, body });
  }

  // Step 4: answer (cached by question+access+selected paths).
  const answerInput = `${args.question}\x00${hash}\x00${[...accessibleSelected].sort().join(",")}`;
  const cachedAnswer = await getCached<AnswerResult>(ANSWER_NS, answerInput);
  let answer: string;
  if (cachedAnswer) {
    answer = cachedAnswer.answer;
  } else {
    const res = await completeJson({
      prompt: buildAnswerPrompt(args.question, loaded),
      validate: isAnswerResult,
    });
    answer = res.answer;
    await setCached(ANSWER_NS, answerInput, { answer });
  }

  // Step 5: citations — resolve book titles in one batched findMany.
  const bookIds = [...new Set(loaded.map((c) => c.bookId))];
  const titleRows = bookIds.length
    ? await db.epubFile.findMany({
        where: { id: { in: bookIds } },
        select: { id: true, title: true },
      })
    : [];
  const titleById = new Map(titleRows.map((r) => [r.id, r.title]));
  const citations: ShelfCitation[] = loaded.map((c) => ({
    bookId: c.bookId,
    bookTitle: titleById.get(c.bookId) ?? c.bookId,
    conceptTitle: c.title,
  }));

  // Step 6: assemble the BuiltPrompt-shaped result.
  const sourceText = loaded.map((c) => c.body).join("\n\n");
  const sourcesLines = citations
    .map((c) => `- ${c.bookTitle} — ${c.conceptTitle}`)
    .join("\n");
  const prompt = `You are Nutshell's ask-your-bookshelf assistant answering from the user's compiled library knowledge base.

${answer}

Sources:
${sourcesLines}`;

  return {
    prompt,
    sourceText,
    bookText: sourceText,
    bookMd5,
    promptVersion: QUERY_PROMPT_VERSION,
    citations,
  };
}

function emptyAnswer(bookMd5: string, message: string): ShelfAnswer {
  return {
    prompt: message,
    sourceText: "",
    bookText: "",
    bookMd5,
    promptVersion: QUERY_PROMPT_VERSION,
    citations: [],
  };
}
