# Phase 3: AI Explainers - Research

**Researched:** 2026-05-07
**Status:** Complete

---

## Research Questions

### 1. OpenRouter API Integration

**Question:** How do we call OpenRouter's chat completion API with streaming (SSE), handle authentication, select models for cost/quality tradeoffs, and manage errors/rate limits?

**Finding:**

OpenRouter exposes a fully OpenAI-compatible API at `https://openrouter.ai/api/v1/chat/completions`. Authentication is via `Authorization: Bearer <API_KEY>` header. Streaming is enabled with `stream: true` in the request body.

Required headers for OpenRouter:
- `Authorization: Bearer ${OPENROUTER_API_KEY}`
- `Content-Type: application/json`
- `HTTP-Referer: <APP_URL>` (required by OpenRouter)
- `X-Title: BusyReader` (identifies the app)

Response format for streaming: Server-Sent Events where each data line is a JSON chunk matching the OpenAI streaming spec (`choices[0].delta.content`).

**Model pricing research (per million tokens):**

| Model | Context | Prompt $/1M | Completion $/1M | Notes |
|---|---|---|---|---|
| `google/gemini-2.0-flash-001` | 1M | $0.10 | $0.40 | Fast, huge context, cheapest quality option. **Recommended for Regular tier.** |
| `google/gemini-2.0-flash-lite-001` | 1M | $0.075 | $0.30 | Even cheaper, slightly lower quality. Good fallback. |
| `anthropic/claude-3.5-haiku` | 200K | $0.80 | $4.00 | Fast Anthropic model, 4x more expensive than Gemini Flash. |
| `openai/gpt-4.1-mini` | 1M | $0.40 | $1.60 | Solid quality, mid-range cost. |
| `anthropic/claude-sonnet-4.6` | 1M | $3.00 | $15.00 | Premium quality. **Recommended for Pro tier (Phase 5).** |
| `deepseek/deepseek-v4-flash` | 1M | $0.14 | $0.28 | Ultra-cheap, good for testing. |
| `meta-llama/llama-4-scout` | 327K | $0.08 | $0.30 | Open model, competitive pricing. |

Error codes from OpenRouter:
- `401` — Invalid API key
- `402` — Insufficient credits (quota exceeded)
- `429` — Rate limit hit (retry with exponential backoff)
- `503` — Model temporarily unavailable (should fall back or retry)

**Recommendation:**
- Use `google/gemini-2.0-flash-001` for Regular tier (best cost/quality/context tradeoff: 1M context at $0.10/$0.40 per million).
- Reserve `anthropic/claude-sonnet-4.6` or `claude-sonnet-latest` for Pro tier (Phase 5).
- Implement exponential backoff on 429/503 errors.
- Set a reasonable `max_tokens` (e.g., 4096 for book-level, 2048 for section-level) to cap cost per request.
- Set `temperature: 0.3` for grounded explanations (lower = less hallucination).

---

### 2. SSE Streaming in Next.js App Router

**Question:** How do we implement SSE streaming from a Next.js API route using ReadableStream, and how does the client consume it?

**Finding:**

Next.js App Router API routes can return a `Response` with a `ReadableStream` body. The pattern is:

**Server (API route):**
```typescript
export async function POST(request: Request) {
  const body = await request.json();
  
  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL!,
      'X-Title': 'BusyReader',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.0-flash-001',
      messages: [{ role: 'user', content: body.prompt }],
      stream: true,
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  // Forward the stream with SSE headers
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
```

**Client-side consumption (fetch + ReadableStream):**
```typescript
const response = await fetch('/api/explainers/generate', {
  method: 'POST',
  body: JSON.stringify({ bookId, type, language }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop()!;
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      const chunk = JSON.parse(data);
      const text = chunk.choices?.[0]?.delta?.content || '';
      // Append text to state
    }
  }
}
```

Note: Using `fetch` + `ReadableStream` is preferred over `EventSource` because:
- `EventSource` only supports GET, but we need POST with a JSON body
- `EventSource` has poor error handling (no access to HTTP status codes)
- `fetch` gives us full control over headers, body, and abort with `AbortController`

**Critical Next.js consideration:** Next.js App Router may buffer responses. To prevent buffering, either:
1. Use `export const dynamic = 'force-dynamic'` in the route file
2. Ensure the route does not use any static optimization signals

**Recommendation:**
- Use the `fetch` + `ReadableStream` pattern on the client, NOT `EventSource`.
- Return the upstream stream directly from the API route (no transformation = lower latency, less memory).
- Use `AbortController` on the client to cancel generation if the user closes the explainer Sheet mid-stream.
- Mark the API route with `export const dynamic = 'force-dynamic'` to prevent Next.js from buffering.

---

### 3. Streaming Text Animation (GSAP-style)

**Question:** How do we implement word-by-word or token-by-token fade-in animation for streaming AI text? Should we use GSAP, Framer Motion, or CSS animations?

**Finding:**

The UI-SPEC.md explicitly specifies a CSS animation approach with `keyframes` and CSS custom properties (`--word-index`). This is the simplest, most performant, and dependency-free approach:

```css
@keyframes fadeInWord {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}

.explainer-word {
  opacity: 0;
  animation: fadeInWord 0.3s ease-out forwards;
  animation-delay: calc(var(--word-index) * 0.04s);
}
```

**Performance considerations:**
- CSS animations run on the compositor thread (GPU), avoiding main-thread jank.
- For very long explainers (>500 words), the UI-SPEC recommends switching to paragraph-level batch animation to reduce DOM node count.
- React re-renders during streaming can be a bottleneck. The text should be stored in a ref or a single state string (not an array of words in state, which triggers re-render on every token).
- **Optimal pattern:** Store the accumulated text in a single `useState` string. Render by splitting the string into word spans in the component body (not in state). This way, React only re-renders the stream component, and the DOM diff is minimal.

**GSAP comparison:**
- GSAP provides finer easing control and timeline sequencing, but adds ~30KB gzipped.
- For a simple word fade-in with fixed stagger, CSS animations are sufficient and zero-bundle-cost.
- If the user wants more elaborate effects later (e.g., per-character typewriter with cursor), GSAP + SplitText would be appropriate.

**Framer Motion comparison:**
- Framer Motion's `AnimatePresence` and `staggerChildren` are powerful but overkill for this use case.
- It would require wrapping every word in a motion span, creating many React components.
- Not recommended for high-frequency streaming updates.

**Recommendation:**
- Use the CSS animation approach specified in the UI-SPEC.md.
- Cap animation delay at 2s (index > 50 gets `animation-delay: 2s` or instant opacity).
- Store streamed text as a single string in React state to minimize re-render cost.
- Defer GSAP/Framer Motion unless the user requests more complex animation choreography.

---

### 4. Prisma Schema Design for Caching

**Question:** What is the best composite unique key pattern for cache lookup, index strategy, and schema for storing Explainer text content?

**Finding:**

The cache key must uniquely identify an explainer by `(content_hash, language, content_type, tier)` per decision D-08 in the CONTEXT.md.

**Proposed schema addition:**

```prisma
model Explainer {
  id            String   @id @default(cuid())
  contentHash   String   // SHA-256 of source text + prompt version
  language      String   @default("en")
  contentType   String   // "book" or "section"
  tier          String   @default("regular") // "regular" | "pro"
  content       String   // The AI-generated explainer text
  modelId       String   // Which model generated this (e.g., "google/gemini-2.0-flash-001")
  promptVersion Int      // Version of the prompt template used
  tokenCount    Int?     // Estimated tokens consumed (for cost tracking)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([contentHash, language, contentType, tier])
  @@index([contentHash])
  @@index([createdAt])
}
```

**Also add `preferredLanguage` to User:**
```prisma
model User {
  // ... existing fields ...
  preferredLanguage String @default("en")
}
```

**Index rationale:**
- `@@unique([contentHash, language, contentType, tier])` — Guarantees exactly one cached explainer per unique content/language/type/tier combo. Fast lookup via the composite index.
- `@@index([contentHash])` — Speeds up cache hit queries when searching by hash only (e.g., "find all explainers for this book").
- `@@index([createdAt])` — Supports admin queries for cache analytics, expiration, or cleanup.

**SQLite considerations:**
- SQLite supports composite unique constraints natively.
- Prisma's `@@unique` generates a `UNIQUE INDEX` in SQLite, which serves both uniqueness enforcement and query acceleration.
- No need for a separate `@@index` on the same columns as `@@unique` — the unique index already covers lookups on the leftmost prefix.
- However, `@@index([contentHash])` is still useful for queries that filter by hash without specifying the other columns.

**Recommendation:**
- Use the schema above with `@@unique([contentHash, language, contentType, tier])`.
- The `contentHash` should be SHA-256, not MD5, to avoid collision risk for content-derived keys (even though MD5 is fine for file deduplication per project mandate).
- Add `promptVersion` to the Explainer model for observability — if an admin changes the prompt template, new explainers get a new version number, but old cached explainers remain valid until explicitly invalidated.

---

### 5. Prompt Engineering for Grounded Explanations

**Question:** How do we construct prompts that ground AI explanations in source text, resist hallucination, handle large source texts (chunking), and implement prompt template variable substitution?

**Finding:**

The project already seeds two prompt templates in `prisma/seed.ts` with `{{variable}}` substitution syntax:

```
Book title: {{title}}
Author: {{author}}
Language: {{language}}
Below is the full text of the book:
---
{{text}}
---
Please provide a comprehensive explanation of this book in {{target_language}}.
```

**Hallucination resistance strategies:**
1. **Grounding instruction:** Explicitly include the source text in the prompt with clear delimiters (`---`).
2. **Constraint instruction:** "Base your explanation ONLY on the text provided above. Do not introduce information not present in the text."
3. **Low temperature:** `temperature: 0.3` reduces creative extrapolation.
4. **System prompt framing:** Set the system message to "You are an expert literary analyst. Your task is to explain the provided text accurately, without adding outside information."

**Handling large source texts:**
- `google/gemini-2.0-flash-001` supports 1M token context (~4M characters for English), which covers the vast majority of books.
- For books exceeding the context window, a two-pass approach is needed:
  1. **Chunking:** Split the book into ~100K-character chunks.
  2. **Summarize-then-explain:** Generate a condensed summary across chunks first, then use the summary as the grounding text for the final explainer.
  3. **Section-level explainers:** For books too large for the context window, section-level explainers (which use individual chapter text) are the primary mechanism.
- For v1, we can assume the full book text fits in Gemini Flash's 1M context. If it doesn't, fall back to section-level explainers as the primary UX.

**Variable substitution pattern:**
A simple regex replace function is sufficient:
```typescript
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
```

Available variables:
- `{{title}}` — Book title
- `{{author}}` — Book author (or "Unknown")
- `{{language}}` — Detected book language
- `{{target_language}}` — User's preferred explainer language
- `{{text}}` — Source text from TXT conversion
- `{{section_title}}` — Section/chapter title (for section-level)

**Recommendation:**
- Use the existing `{{var}}` substitution pattern from seed templates.
- Implement `fillTemplate()` as a simple regex replacer — no need for a template engine.
- For book-level explainers, inject the full TXT content directly into the prompt (Gemini Flash's 1M context handles most books).
- Add an explicit grounding constraint to both templates: "Base your explanation ONLY on the text provided."
- Set `temperature: 0.3` on all explainer requests.
- For books that exceed context limits, return a graceful error: "This book is too large for a book-level explainer. Try section-level explainers instead."

---

### 6. Content Hash Strategy

**Question:** How do we compute SHA-256 hashes for cache keys, and how do we include prompt template version in the hash to invalidate cache when templates change?

**Finding:**

Node.js v25.9.0 has built-in `crypto.createHash('sha256')` (tested). The Web Crypto API (`crypto.subtle.digest`) is also available but `crypto.createHash` is simpler for synchronous/streaming use.

**Cache key computation:**
```typescript
import crypto from 'crypto';

function computeContentHash(
  sourceText: string,
  promptVersion: number,
  promptType: string
): string {
  const hash = crypto.createHash('sha256');
  hash.update(promptType);      // "book" or "section"
  hash.update('\x00');          // delimiter
  hash.update(sourceText);      // The actual text content
  hash.update('\x00');
  hash.update(String(promptVersion));
  return hash.digest('hex');
}
```

**Why include prompt version in the hash?**
- When an admin edits the prompt template, the `version` field increments.
- New explainers get a different hash, so they don't collide with old cached explainers.
- Old cached explainers remain in the database (no destructive invalidation).
- This is a lazy invalidation strategy: old explainers are simply no longer found by cache lookup, and can be cleaned up later by a background job.

**Why SHA-256 instead of MD5?**
- The project mandate requires MD5 as the **sole book identifier** for deduplication. This is about **file identity**.
- Content hashes for caching are a different concern: collision resistance matters because a collision would serve the wrong explainer.
- SHA-256 provides 256 bits of collision resistance vs MD5's broken 128 bits.
- Use MD5 for `epub_files.md5` (file dedup per mandate), SHA-256 for `explainer.contentHash` (cache integrity).

**Recommendation:**
- Use `crypto.createHash('sha256')` from Node.js built-in `crypto` module.
- Hash format: `SHA256(type + NUL + sourceText + NUL + promptVersion)`.
- Include `promptType` ("book" vs "section") in the hash because a book-level and section-level explainer for the same source text are different content.
- Include `promptVersion` so template changes automatically create new cache entries.
- Do NOT include `language` or `tier` in the hash — those are lookup parameters, not content properties. The composite unique key handles them.

---

## Validation Architecture

### Dimension 1: Coverage Verification

| Requirement | Testable Criteria |
|---|---|
| EXP-01 | Click "Explain this to me" on book detail page → API returns stream → text animates in |
| EXP-02 | Click Sparkles icon on ToC entry → API returns section-level stream |
| EXP-04 | Inspect network tab: POST to `/api/explainers/generate` with `language` param; response is `text/event-stream` |
| EXP-05 | Click "Explain" twice on same book → second request returns cached text instantly (no SSE stream) |
| EXP-06 | Delete explainer from DB → click "Explain" → new stream generates and caches |
| EXP-07 | Verify prompt includes `{{text}}` substitution from TXT file; explainer references actual book content |
| LANG-01 | Open profile modal, change language, save → DB `User.preferredLanguage` updates |
| LANG-02 | Re-open profile modal → previously saved language is pre-selected |

**Cache hit verification:**
- Query `Explainer` table directly: `SELECT * FROM Explainer WHERE contentHash = ? AND language = ? AND contentType = ? AND tier = ?`
- Should return exactly one row on cache hit, zero on miss.

### Dimension 2: Integration Points

| Integration | Existing Code | New Code |
|---|---|---|
| Book detail page trigger | `src/app/(library)/book/[id]/page.tsx` — add button next to "Open Reader" | `ExplainerTrigger` component |
| ToC panel trigger | `src/components/reader/toc-panel.tsx` — add Sparkles icon per entry | Inline `SectionExplainerTrigger` |
| Reader chrome slot | `src/components/reader/reader-chrome.tsx` — slot-based composition | Pass profile trigger as new slot |
| Auth-gated API | `src/app/api/reader/position/route.ts` — `requireAuth()` + `verifyBookAccess()` | `/api/explainers/*` routes |
| Prompt template CRUD | `src/app/api/admin/prompts/route.ts` + `src/server/services/admin.ts` | Reuse `getPromptTemplate()` and `updatePromptTemplate()` |
| TXT source for grounding | `src/server/services/epub-processor.ts` — `txtPath` stored on `EpubFile` | Read TXT via `storage.read()` |
| Prisma upsert pattern | `src/server/services/reader.ts` — `userBookPosition.upsert()` | `explainer.upsert()` for caching |
| Storage read | `src/server/storage/local.ts` — `read()` returns `Buffer` | Convert to string for prompt injection |
| Language detection | `src/lib/language.ts` — `detectLanguage()` with franc | Reuse for book language; user language from profile |

### Dimension 3: Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OpenRouter API key missing/invalid | Medium | High | Fail fast with clear error message; disable explain UI if `OPENROUTER_API_KEY` not set |
| Book text exceeds LLM context window | Low-Medium | High | Check text length before sending; if > 900K chars, reject book-level and suggest section-level |
| SSE stream interrupted (network drop) | Medium | Medium | Client should detect incomplete stream and show "Generation interrupted" with retry button |
| Rate limit (429) from OpenRouter | Medium | Medium | Exponential backoff (1s, 2s, 4s); show "Service busy, retrying..." to user |
| Prompt template produces poor quality | Medium | High | Admin can edit templates live; version increment creates new cache entries; old cached explainers can be manually deleted |
| SHA-256 collision on content hash | Negligible | Critical | SHA-256 has no known practical collisions; acceptable risk |
| CSS word animation performance on long text | Low | Low | Cap animation delay at 2s; switch to paragraph batching for >500 words |
| SQLite WAL mode not enabled | Unknown | Medium | Verify `PRAGMA journal_mode=WAL` is set for write-heavy cache operations |

---

## Codebase Analysis

### Existing Patterns to Reuse

1. **Auth-gated API routes** (`src/app/api/reader/position/route.ts`)
   - Pattern: `requireAuth()` → validate params → `verifyBookAccess()` → service call → JSON response
   - Error handling: catch `AuthError` by `statusCode` for 401/403, generic 500 for others
   - Reuse for all explainer API routes

2. **Prisma upsert** (`src/server/services/reader.ts`)
   - Pattern: `upsert({ where: { compositeKey }, create: {...}, update: {...} })`
   - Use for cache writes: if explainer exists, don't overwrite; if not, create

3. **Service layer pattern** (`src/server/services/reader.ts`, `src/server/services/admin.ts`)
   - Each feature has a service file with async functions
   - Service functions accept primitives, not Request objects
   - Create `src/server/services/explainer.ts` following this pattern

4. **Prompt template CRUD** (`src/server/services/admin.ts`)
   - `getPromptTemplate(type)` — fetch by type ("book" or "section")
   - `updatePromptTemplate(adminId, type, content)` — updates with version increment + audit log
   - Reuse directly; no new admin UI needed

5. **TanStack Query + mutations** (`src/app/admin/prompts/page.tsx`)
   - `useQuery` for cache checks
   - `useMutation` for generation triggers
   - `useQueryClient().invalidateQueries()` for cache invalidation

6. **Sheet + ScrollArea** (`src/components/reader/toc-panel.tsx`)
   - Same pattern for explainer panel: `side="right"`, `ScrollArea` for content
   - Reuse `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`

7. **Storage abstraction** (`src/server/storage/local.ts`)
   - `storage.read(book.txtPath)` returns `Buffer`
   - Convert to string with `.toString('utf-8')` for prompt injection

8. **Audit logging** (`src/server/services/admin.ts`)
   - Every admin mutation logs to `AuditLog`
   - Prompt template updates are already audited
   - Consider auditing explainer generation costs in future

### New Code Needed

1. **Prisma schema changes** — Add `Explainer` model and `User.preferredLanguage`
2. **Database migration** — `prisma migrate dev` for schema changes
3. **Explainer service** — `src/server/services/explainer.ts`
   - `getExplainer(contentHash, language, type, tier)` — cache lookup
   - `createExplainer(data)` — cache write
   - `generateExplainer(params)` — orchestrates OpenRouter call + cache write
   - `computeContentHash(sourceText, promptVersion, type)` — SHA-256
4. **Prompt builder** — `src/server/services/prompt-builder.ts`
   - `fillTemplate(template, vars)` — `{{var}}` substitution
   - `buildBookPrompt(book, template, language)` — reads TXT, fills vars
   - `buildSectionPrompt(book, section, template, language)` — extracts section text (needs section text extraction from TXT)
5. **API routes** — `src/app/api/explainers/`
   - `GET /api/explainers?bookId=X&type=book|section&lang=Y&tier=Z` — cache check
   - `POST /api/explainers/generate` — triggers SSE stream
   - `PATCH /api/user/language` — update preferred language
6. **Client components**
   - `src/components/explainer/explainer-trigger.tsx` — book-level button
   - `src/components/explainer/explainer-panel.tsx` — right Sheet with states
   - `src/components/explainer/explainer-stream.tsx` — CSS word animation
   - `src/components/profile/profile-modal.tsx` — Dialog for language preference
7. **Section text extraction** — `src/server/services/section-extractor.ts`
   - Given a book's TXT and a ToC href, extract the section's text
   - Needed for section-level explainers
8. **Environment variable** — `OPENROUTER_API_KEY` added to `.env`

---

## Dependencies

### New Packages Needed

| Package | Version | Why |
|---|---|---|
| None required for core functionality | — | OpenRouter is called via standard `fetch` (OpenAI-compatible). No SDK needed. |

**Optional packages to consider:**

| Package | Why | Decision |
|---|---|---|
| `openai` | Official SDK handles streaming parsing, retries, types | **Defer.** Adds dependency; `fetch` + manual SSE parsing is sufficient for v1. |
| `ai` (Vercel AI SDK) | Higher-level streaming utilities, React hooks (`useChat`) | **Defer.** Adds abstraction; our UI-SPEC has custom animation requirements that don't fit `useChat` patterns. |
| `gsap` | Advanced animation control | **Defer.** CSS animations cover the current spec. Revisit if user requests more complex effects. |

### Existing Packages to Leverage

| Package | How |
|---|---|
| `@prisma/client` (5.22.0) | Already installed. Use for `Explainer` CRUD, `User.preferredLanguage` updates. |
| `@tanstack/react-query` (5.100.9) | Already installed. Use `useQuery` for cache checks, `useMutation` for generation, `useQueryClient` for invalidation. |
| `better-auth` (1.6.9) | Already installed. Session already includes `user.role`. Add `preferredLanguage` to user metadata or extend session. |
| `sonner` (2.0.7) | Already installed. Toast notifications for "Generating...", "Loaded from cache", errors. |
| `lucide-react` (1.14.0) | Already installed. Use `Sparkles`, `Loader2`, `AlertCircle`, `RotateCcw`, `Globe` icons. |
| `franc` (6.2.0) | Already installed. Used for book language detection at upload. Not needed for explainer language (user-selected). |
| `zustand` (5.0.13) | Already installed. Could manage explainer panel open/close state globally, but local state in components is sufficient for v1. |
| `next` (16.2.5) | Built-in `fetch`, `ReadableStream`, `Response` support for SSE streaming. App Router API routes for explainer endpoints. |

---

## Appendix: OpenRouter SSE Chunk Format

When `stream: true`, OpenRouter returns Server-Sent Events:

```
data: {"id":"...","object":"chat.completion.chunk","created":1234567890,"model":"google/gemini-2.0-flash-001","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"...","object":"chat.completion.chunk","created":1234567890,"model":"google/gemini-2.0-flash-001","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}

data: [DONE]
```

The client parses each `data:` line, extracts `choices[0].delta.content`, and appends to the displayed text.

---

## Appendix: Section Text Extraction Strategy

The `txtPath` file contains the full book text with paragraphs separated by `\n\n`. To extract a section's text for section-level explainers:

1. **Index-based approach (recommended for v1):**
   - Store the paragraph offset range for each ToC entry during EPUB parsing.
   - At upload time, after extracting text, compute paragraph indices for each section boundary.
   - Store these indices in `tocJson` or a new `Section` table.
   - For section-level explainers, read the full TXT and slice by paragraph range.

2. **Href-based approach (fallback):**
   - Use the ToC entry's `href` to find the corresponding HTML file in the EPUB.
   - Re-extract text from that specific HTML file.
   - More accurate but requires re-parsing EPUB or storing per-section text.

**Recommendation for v1:** Use the index-based approach. Augment the `TocEntry` type to include `paragraphStart` and `paragraphEnd` during upload. Store these in `tocJson`. The section text is then a simple slice of the full TXT file.

---

*Phase: 03-ai-explainers*
*Research completed: 2026-05-07*
