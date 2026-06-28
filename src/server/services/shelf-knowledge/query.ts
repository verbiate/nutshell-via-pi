import crypto from "node:crypto";
import { db } from "@/server/db";
import { fillTemplate } from "@/server/services/prompt-builder";
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

// ponytail: fallback content used when the DB template row is missing (fresh
// DB not yet seeded, or the row was deleted). Mirrors the seeded defaults
// (seed.ts SHELF_NAV_PROMPT_CONTENT / SHELF_ANSWER_PROMPT_CONTENT) verbatim so
// behavior is unchanged in the happy path. Loaded template.content overrides.
const FALLBACK_NAV_CONTENT = `You are navigating the user's library knowledge base to find concepts relevant to their question.

Available concepts (only from books the user has access to):
{{listing}}

User question: {{question}}

Return ONLY valid JSON matching this schema:
{
  "conceptRelPaths": ["<a path from the list above>"]
}

Constraints:
- Every conceptRelPath MUST be one of the exact paths listed above — do not invent or alter them.
- Pick only concepts relevant to answering the question.
- Select at most ${MAX_CONCEPTS}.
- If none are relevant, return an empty array.`;

const FALLBACK_ANSWER_CONTENT = `Answer the user's question using ONLY the provided concept excerpts from their library knowledge base.

User question: {{question}}

Concept excerpts:
{{concept_excerpts}}

Answer using ONLY the information in these excerpts. If they do not contain the answer, say so plainly. Do not use outside knowledge.

Return ONLY valid JSON matching this schema:
{ "answer": "<your grounded answer>" }`;

// ponytail: fallback version mirroring the seeded default so a missing row
// preserves cache stability. Loaded template.version overrides.
const FALLBACK_NAV_VERSION = 1;
const FALLBACK_ANSWER_VERSION = 1;

interface LoadedTemplate {
  content: string;
  version: number;
}

// ponytail: loads a shelf prompt template from DB with a hardcoded fallback.
// Mirrors extract.ts:loadExtractTemplate. Never throws — a missing row is
// treated as "use the seeded default" rather than crashing the query.
async function loadShelfPrompt(
  type: "shelf_nav" | "shelf_answer",
): Promise<LoadedTemplate> {
  const fallback =
    type === "shelf_nav"
      ? { content: FALLBACK_NAV_CONTENT, version: FALLBACK_NAV_VERSION }
      : { content: FALLBACK_ANSWER_CONTENT, version: FALLBACK_ANSWER_VERSION };
  const row = await db.promptTemplate.findUnique({ where: { type } });
  return row
    ? { content: row.content, version: row.version }
    : fallback;
}

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

async function buildNavPrompt(
  question: string,
  entries: IndexEntry[],
): Promise<{ prompt: string; version: number }> {
  const listing = entries
    .map((e) => `- [${e.relPath}] ${e.title}${e.desc ? ` — ${e.desc}` : ""}`)
    .join("\n");
  const tpl = await loadShelfPrompt("shelf_nav");
  return {
    prompt: fillTemplate(tpl.content, { listing, question }),
    version: tpl.version,
  };
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

async function buildAnswerPrompt(
  question: string,
  concepts: LoadedConcept[],
): Promise<{ prompt: string; version: number }> {
  const concept_excerpts = concepts
    .map((c) => `## ${c.title} (from ${c.bookId})\n${c.body}`)
    .join("\n\n");
  const tpl = await loadShelfPrompt("shelf_answer");
  return {
    prompt: fillTemplate(tpl.content, { question, concept_excerpts }),
    version: tpl.version,
  };
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
  // ponytail: load the nav template up-front so its .version can fold into the
  // cache key (admin save → version bump → cache miss → re-navigate with new
  // prompt). The prompt body is only used on cache miss.
  const { prompt: navPrompt, version: navVersion } = await buildNavPrompt(
    args.question,
    filteredEntries,
  );
  const navInput = `${args.question}\x00${hash}\x00${navVersion}`;
  const cachedNav = await getCached<NavResult>(NAV_NS, navInput);
  let selected: string[];
  if (cachedNav) {
    // ponytail: re-validate against the current known set — access may have
    // changed since the nav result was cached.
    selected = cachedNav.conceptRelPaths.filter((p) => knownPaths.has(p));
  } else {
    const nav = await completeJson({
      prompt: navPrompt,
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
  // ponytail: skip-and-continue on read failure — one missing/corrupt concept
  // file must not 500 the whole query. If ALL selected concepts fail to read,
  // fall back to the nothing-found answer (empty citations) so the user still
  // gets a clean response instead of a crash.
  const loaded: LoadedConcept[] = [];
  for (const rel of accessibleSelected) {
    let body: string;
    try {
      body = await readWikiFile(rel);
    } catch {
      continue;
    }
    const bookId = bookIdOfRelPath(rel)!; // safe: accessibleSelected only contains matching relPaths
    const title = parseTitle(body, rel);
    loaded.push({ relPath: rel, title, bookId, body });
  }
  if (loaded.length === 0) {
    return emptyAnswer(bookMd5, FALLBACK_NOTHING_FOUND);
  }

  // Step 4: answer (cached by question+access+selected paths).
  // ponytail: answer template .version folds into the key — independent from
  // nav's version since each template bumps on its own edits.
  const { prompt: answerPrompt, version: answerVersion } = await buildAnswerPrompt(
    args.question,
    loaded,
  );
  const answerInput = `${args.question}\x00${hash}\x00${[...accessibleSelected].sort().join(",")}\x00${answerVersion}`;
  const cachedAnswer = await getCached<AnswerResult>(ANSWER_NS, answerInput);
  let answer: string;
  if (cachedAnswer) {
    answer = cachedAnswer.answer;
  } else {
    const res = await completeJson({
      prompt: answerPrompt,
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
    promptVersion: answerVersion,
    citations,
  };
}

function emptyAnswer(bookMd5: string, message: string): ShelfAnswer {
  // ponytail: empty/fallback answers are hardcoded (never produced by the
  // answer LLM), so the answer template's version doesn't apply. Use the
  // fallback version (= seeded default) to keep the field stable.
  return {
    prompt: message,
    sourceText: "",
    bookText: "",
    bookMd5,
    promptVersion: FALLBACK_ANSWER_VERSION,
    citations: [],
  };
}
