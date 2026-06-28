import crypto from "node:crypto";
import { db } from "@/server/db";
import {
  buildBookIndex,
  buildChapterIndex,
  fillTemplate,
} from "@/server/services/prompt-builder";
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
{{conversation}}
User question: {{question}}

Return ONLY valid JSON matching this schema:
{
  "conceptRelPaths": ["<a path from the list above>"]
}

Constraints:
- Every conceptRelPath MUST be one of the exact paths listed above — do not invent or alter them.
- Pick only concepts relevant to answering the question.
- The latest question may refer to something in the recent conversation (e.g. "those", "deep links for that", "the startup one") — pick concepts relevant in that context.
- Select at most ${MAX_CONCEPTS}.
- If none are relevant, return an empty array.`;

const FALLBACK_ANSWER_CONTENT = `Answer the user's question using ONLY the provided concept excerpts from their library knowledge base.
{{conversation}}
User question: {{question}}

Concept excerpts:
{{concept_excerpts}}

Library manifest — every book the user has access to. Each entry is a ready-to-use link to open the book; copy the (#book:…) href verbatim and reword the label if you like:
{{library_manifest}}

Book index — books cited in the excerpts above (a subset of the library). Each entry is a ready-to-use link to open the book itself; copy the (#book:…) href verbatim and reword the label if you like:
{{book_index}}

Chapter maps for cited books — each entry is a ready-to-use link to a specific chapter; copy the (#ch:…) href verbatim (including the <bookId>: prefix) and reword the label if you like:
{{chapter_maps}}

Weave citations INTO THE VISIBLE REPLY as inline links:
- For a claim about the book as a whole (mentioning the book, its thesis, its author, recommending it), use the book form: [Book Title](#book:<bookId>) with hrefs copied verbatim from the library manifest or book index above. You may mention books from the library manifest when their title or subject is relevant to the question, even if no concept excerpt was read from them — link them with the #book: form. One book-level link per book referenced.
- For a claim grounded in a specific passage, use the chapter form: [Chapter Label](#ch:<bookId>:<basename>) with hrefs copied verbatim from the chapter maps above. One chapter link per grounded claim. Chapter links require a concept excerpt to have been read from that book — do not invent chapter hrefs for books that only appear in the library manifest.
Do NOT add a separate "Sources:" list; the inline links ARE the citations. Do not invent hrefs that are not in the library manifest, book index, or chapter maps.

Answer using ONLY the information in these excerpts plus the book titles in the library manifest. If the excerpts do not contain the answer but a library book's title suggests it may be relevant, say so plainly and link the book. Do not use outside knowledge beyond what the excerpts and titles provide.

Return ONLY valid JSON matching this schema:
{ "answer": "<your grounded answer with inline #book: and #ch: links>" }`;

// ponytail: fallback version mirroring the seeded default so a missing row
// preserves cache stability. Loaded template.version overrides.
const FALLBACK_NAV_VERSION = 2;
const FALLBACK_ANSWER_VERSION = 5;

// ponytail: shape of prior turns threaded from streamFollowup → answerShelfQuestion.
// First turn passes none — shelf discussions start with no history.
export interface ShelfHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

// ponytail: render the last ~6 turns as a labeled block, or "" when no history.
// Frame text lives here (not in the template) so an empty history substitutes
// to a truly empty string — no dangling "Recent conversation:" header on turn 1.
function formatHistory(history?: ShelfHistoryEntry[]): string {
  if (!history || history.length === 0) return "";
  const last = history.slice(-6);
  const lines = last.map(
    (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
  );
  return `\nRecent conversation for context (the user's latest question may refer to something here — e.g. "those", "deep links for that", "the startup one"):\n${lines.join("\n")}\n`;
}

// ponytail: history folded into BOTH cache keys so different conversations never
// collide on a stale first-turn entry. Follow-ups rarely cache-hit anyway, but
// correctness matters. \x00 separator matches the existing key convention.
function historyHash(history?: ShelfHistoryEntry[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(history ?? []))
    .digest("hex")
    .slice(0, 16);
}

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
  conversation: string,
): Promise<{ prompt: string; version: number }> {
  const listing = entries
    .map((e) => `- [${e.relPath}] ${e.title}${e.desc ? ` — ${e.desc}` : ""}`)
    .join("\n");
  const tpl = await loadShelfPrompt("shelf_nav");
  return {
    prompt: fillTemplate(tpl.content, { listing, question, conversation }),
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
  chapterMaps: string,
  bookIndex: string,
  libraryManifest: string,
  conversation: string,
): Promise<{ prompt: string; version: number }> {
  const concept_excerpts = concepts
    .map((c) => `## ${c.title} (from ${c.bookId})\n${c.body}`)
    .join("\n\n");
  const tpl = await loadShelfPrompt("shelf_answer");
  return {
    prompt: fillTemplate(tpl.content, {
      question,
      concept_excerpts,
      chapter_maps: chapterMaps,
      book_index: bookIndex,
      library_manifest: libraryManifest,
      conversation,
    }),
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
  history?: ShelfHistoryEntry[];
}): Promise<ShelfAnswer> {
  const access = new Set(args.accessibleBookIds);
  const hash = accessHash(args.accessibleBookIds);
  const bookMd5 = `shelf:${hash}`;
  const conversation = formatHistory(args.history);
  const histHash = historyHash(args.history);

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
    conversation,
  );
  const navInput = `${args.question}\x00${hash}\x00${navVersion}\x00${histHash}`;
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

  // Step 3b: build per-cited-book chapter maps + a book-level index so the
  // answer model can emit both #ch:<bookId>:<basename> chapter deep links AND
  // #book:<bookId> book-level links (mirrors discussions.ts buildAttachmentSuffix
  // + prompt-builder.ts buildChapterIndex). ponytail: fetch title + tocJson in
  // ONE findMany — both the book index (buildBookIndex) and the Step 5
  // citations need titles, so hoisting here avoids a second DB round-trip.
  // cited-book-set is a function of accessibleSelected (already in the answer
  // cache key), so manifest contents add no new cache axis; ceiling: a
  // re-ingested ToC or renamed title for an already-cited book won't
  // invalidate the answer cache until the answer template version bumps.
  // Acceptable — rare and self-heals on next bump.
  const citedBookIds = [...new Set(loaded.map((c) => c.bookId))];
  const citedBookRows = citedBookIds.length
    ? await db.epubFile.findMany({
        where: { id: { in: citedBookIds } },
        select: { id: true, title: true, tocJson: true },
      })
    : [];
  const tocById = new Map(citedBookRows.map((r) => [r.id, r.tocJson]));
  const titleById = new Map(citedBookRows.map((r) => [r.id, r.title]));
  const chapterMaps = citedBookIds
    .map((bid) => {
      const map = buildChapterIndex(tocById.get(bid) ?? null, 50, bid);
      return map
        ? `### ${bid}\n${map}`
        : `### ${bid}\n(no chapter map available for this book)`;
    })
    .join("\n\n");
  const bookIndex = buildBookIndex(
    citedBookIds.map((id) => ({ id, title: titleById.get(id) ?? id })),
  );

  // Step 3c: build the library manifest — ALL accessible books (not just cited
  // ones) — so the answer model can recommend books by TITLE even when no
  // concept excerpt was read from them. ponytail: this is the recall fix for
  // "books about war" missing Guns, Germs, and Steel — no GGS concept mentions
  // war, so nav never selects it, but its title is obviously relevant. The
  // manifest lets the model surface it with a #book: link. Separate findMany
  // from Step 3b (different SELECT, different id set) — cheap, one row per book.
  const libraryRows = args.accessibleBookIds.length
    ? await db.epubFile.findMany({
        where: { id: { in: args.accessibleBookIds } },
        select: { id: true, title: true },
      })
    : [];
  const libraryManifest = buildBookIndex(libraryRows);

  // Step 4: answer (cached by question+access+selected paths).
  // ponytail: answer template .version folds into the key — independent from
  // nav's version since each template bumps on its own edits.
  const { prompt: answerPrompt, version: answerVersion } = await buildAnswerPrompt(
    args.question,
    loaded,
    chapterMaps,
    bookIndex,
    libraryManifest,
    conversation,
  );
  const answerInput = `${args.question}\x00${hash}\x00${[...accessibleSelected].sort().join(",")}\x00${answerVersion}\x00${histHash}`;
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

  // Step 5: citations — titles already fetched in Step 3b, just map them out.
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
