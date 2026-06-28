import { getCached, setCached } from "./cache";
import { completeJson } from "./llm-json";
import { conceptRelPath } from "./render";
import type { OkfClusterTheme, OkfConcept } from "./types";

export interface ClusterBookConcepts {
  bookId: string;
  bookTitle: string;
  concepts: OkfConcept[];
}

const CACHE_NS = "synthesize";
// ponytail: cache-invalidation knob. Bump when the prompt text or synthesis
// schema changes — without it, prompt edits silently serve stale themes.
// Mirrors extract.ts's EXTRACT_PROMPT_VERSION pattern.
export const SYNTH_PROMPT_VERSION = 1;

// ponytail: cap per-concept bodyField text so a book with many concepts
// doesn't blow the context window. Truncates each field value; concepts
// themselves are not dropped (clusters rarely have >20). Upgrade to ranked
// selection if clusters regularly have 50+ concepts.
const MAX_FIELD_CHARS = 240;

function summarizeConcept(c: OkfConcept): string {
  const fields = Object.entries(c.bodyFields)
    .map(([k, v]) => {
      const vs =
        v.length > MAX_FIELD_CHARS
          ? `${v.slice(0, MAX_FIELD_CHARS - 1).trimEnd()}…`
          : v;
      return `${k}: ${vs}`;
    })
    .join("; ");
  return `- ${c.title} [${c.conceptType}] (id: ${conceptRelPath(c)}) — ${fields}`;
}

function buildPrompt(args: {
  topic: string;
  bookConcepts: ClusterBookConcepts[];
  knownIds: Set<string>;
}): string {
  const blocks = args.bookConcepts.map((b) => {
    const lines = b.concepts.map(summarizeConcept).join("\n");
    return `### ${b.bookTitle} (${b.bookId})\n${lines}`;
  });
  const idList = [...args.knownIds].sort().map((id) => `- ${id}`).join("\n");
  return `You are synthesizing a cross-book theme for books that share the topic "${args.topic}".

Concepts extracted from each book:

${blocks.join("\n\n")}

Identify ONE shared theme that connects concepts ACROSS these books. Return ONLY valid JSON matching this schema:

{
  "title": "<concise theme title>",
  "summary": "<2-4 sentences comparing how these books approach the theme>",
  "relatedConceptIds": ["<concept id from the list below>"]
}

Constraints:
- Every relatedConceptId MUST be one of these exact ids — do not invent or alter them:
${idList}
- Prefer concepts drawn from multiple books (the point is the cross-book connection).
- Do not include a "topic" field; it is stamped by the caller.`;
}

interface RawTheme {
  title: string;
  summary: string;
  relatedConceptIds: string[];
}

// ponytail: type guard closes over the cluster's known concept-id set so it
// rejects any invented relatedConceptId — defense before the renderer's own
// check (render.ts:66). completeJson retries once on rejection.
function makeValidator(knownIds: Set<string>): (x: unknown) => x is RawTheme {
  return (x: unknown): x is RawTheme => {
    if (typeof x !== "object" || x === null) return false;
    const r = x as Record<string, unknown>;
    return (
      typeof r.title === "string" &&
      r.title.length > 0 &&
      typeof r.summary === "string" &&
      r.summary.length > 0 &&
      Array.isArray(r.relatedConceptIds) &&
      r.relatedConceptIds.every(
        (id) => typeof id === "string" && knownIds.has(id),
      )
    );
  };
}

export async function synthesizeClusterTheme(args: {
  topic: string;
  bookConcepts: ClusterBookConcepts[];
}): Promise<OkfClusterTheme> {
  const knownIds = new Set(
    args.bookConcepts.flatMap((b) => b.concepts.map(conceptRelPath)),
  );

  // ponytail: cluster signature = topic + sorted bookIds + prompt version.
  // Folding version in means a prompt/schema edit busts the cache; getCached
  // SHA-256s this input (cache.ts:7). bookIds sorted so cluster member order
  // doesn't fragment the cache.
  const sortedBookIds = args.bookConcepts.map((b) => b.bookId).sort();
  const cacheInput = `${args.topic}\x00${sortedBookIds.join(",")}\x00${SYNTH_PROMPT_VERSION}`;
  const cached = await getCached<OkfClusterTheme>(CACHE_NS, cacheInput);
  if (cached) return cached;

  const prompt = buildPrompt({ ...args, knownIds });
  const raw = await completeJson({
    prompt,
    validate: makeValidator(knownIds),
  });

  // ponytail: stamp topic from the cluster — never trust the LLM for shelf
  // grouping (mirrors extract.ts stamping sourceBookId/topic/form). A
  // hallucinated topic would mis-file the theme on the shelf.
  const theme: OkfClusterTheme = {
    topic: args.topic,
    title: raw.title,
    summary: raw.summary,
    relatedConceptIds: [...raw.relatedConceptIds],
  };
  await setCached(CACHE_NS, cacheInput, theme);
  return theme;
}
