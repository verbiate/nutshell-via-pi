# Ask Your Bookshelf — Stage 1, Plan 1: Foundation Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the end-to-end plumbing for "ask your bookshelf" — a new `"shelf"` discussion type, created from the shelf-bar input, persisted with a nullable `bookId`, routed through a swappable `ContextSourceStrategy`, and streamed back — using a **stub** context source so the whole skeleton is testable before the real OKF engine (Plan 2) exists.

**Architecture:** Make `Discussion.bookId` nullable and add a `"shelf"` type. Introduce a `ContextSourceStrategy` interface whose `buildContext()` returns the existing `BuiltPrompt` shape; a stub implements it for Plan 1. Wire a `"shelf"` branch into the three prompt-assembly seams + a new `streamShelfFirstTurn` (mirrors the blank-discussion flow, minus the single book). The shelf-bar input gets an Enter handler that POSTs a shelf discussion and flips to the Discussions tab; `DiscussionsHomeView` gains a create mutation + a book-less row branch.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 5.22 (SQLite, non-default schema path), TanStack Query 5, shadcn/ui, Vitest 4, OpenRouter (existing `getOpenRouterConfig`).

## Global Constraints

- **Prisma schema path is non-default:** every Prisma command uses `--schema=src/server/db/schema.prisma` (the npm scripts already encode this; use `npm run db:*`).
- **After ANY schema change + `db:generate`/`db:migrate`, restart the dev server** — `kill -9 $(lsof -ti:3000) && npm run dev`. There is **no `scripts/dev.sh`** in this repo. A stale in-memory PrismaClient silently 500s on new nullable columns (AGENTS.md).
- **Prisma pinned at 5.22** — do not bump.
- **Type literals for `Discussion.type`** live in three app-level allowlists (no DB enum exists): API route, `discussions.ts` types, `discussions-panel.tsx`. All three must gain `"shelf"`.
- **No new external dependencies in Plan 1** — OpenRouter only. The OKF engine and embeddings are Plan 2/3.
- **Run tests:** `npm test` (Vest). **Lint:** `npm run lint`.
- **Product copy:** the shelf-bar placeholder becomes **"Ask your books…"** (drop the "search" over-promise; search is a later plan).
- **Ponytail house style:** `// ponytail:` comments mark deliberate simplifications with their ceiling + upgrade path. No comments unless asked EXCEPT these.

## File Structure (Plan 1)

**Create:**
- `src/server/services/shelf-knowledge/types.ts` — `ContextSourceStrategy` interface + `OkfConcept` JSON types + `ShelfLlmConfig`.
- `src/server/services/shelf-knowledge/config.ts` — `getShelfLlmConfig()` (admin key + AppSetting model override).
- `src/server/services/shelf-knowledge/context-source.ts` — `getContextSource()` factory + `StubContextSource` (Plan 1) + the `OkfContextSource` slot (Plan 2).
- `src/server/services/shelf-knowledge/access.ts` — `getAccessibleBookIds(userId)` (the `UserBookAccess` derivation used by every shelf flow).
- `src/server/services/shelf-knowledge/__tests__/{config,access}.test.ts`

**Modify:**
- `src/server/db/schema.prisma` — `Discussion.bookId` → nullable; optional `book` relation.
- `src/server/services/discussions.ts` — `"shelf"` in type literals; `"shelf"` branch in `buildPromptData` / `rebuildSystemPrompt`; new `streamShelfFirstTurn`.
- `src/app/api/discussions/route.ts` — allow `type:"shelf"`, optional `bookId`, shelf-scope access check, route to `streamShelfFirstTurn`.
- `src/components/library/home-view.tsx` — bar Enter handler + placeholder copy + state.
- `src/components/library/discussions-home.tsx` — create mutation (`POST /api/discussions` shelf) + book-less shelf-row branch + `onCreateShelfDiscussion` prop.
- `src/types/discussion.ts` (or wherever `DiscussionListItem` lives) — make `book` optional.

**Plan 1 does NOT touch:** the OKF engine (compile/query), embeddings, the admin panel, prompt templates, the reader. All Plan 2/3.

---

### Task 1: Schema migration — nullable `Discussion.bookId`

**Files:**
- Modify: `src/server/db/schema.prisma:384-411` (the `Discussion` model)

**Interfaces:**
- Produces: `Discussion.bookId` is now `String?`; the `book` relation is optional. Later tasks rely on being able to `db.discussion.create({ data: { ..., bookId: null ... } })` for `type:"shelf"`.

- [ ] **Step 1: Edit the Discussion model**

In `src/server/db/schema.prisma`, change `bookId` and the `book` relation to optional. The model header through the relations currently reads (lines ~384-404):

```prisma
model Discussion {
  id              String   @id @default(cuid())
  userId          String
  bookId          String
  ...
  book         EpubFile   @relation(fields: [bookId], references: [id], onDelete: Cascade)
```

Change exactly two lines:

```prisma
  bookId          String?
```

```prisma
  book         EpubFile?  @relation(fields: [bookId], references: [id], onDelete: Cascade)
```

Leave `@@index([userId, bookId])` and `@@unique([userId, contentHash, language, tier])` unchanged (both are valid with null `bookId`; SQLite treats NULL unique values as distinct, so shelf discussions never collide).

- [ ] **Step 2: Create the migration**

Run:
```bash
npx prisma migrate dev --name shelf_discussion_nullable_bookid --schema=src/server/db/schema.prisma
```
Expected: migration created under `src/server/db/migrations/`, client regenerated, `db.discussion` now accepts `bookId: null`.

- [ ] **Step 3: Restart the dev server (mandatory)**

```bash
kill -9 $(lsof -ti:3000) && npm run dev
```
Expected: dev server boots clean on :3000. (A stale PrismaClient would 500 on the now-nullable column — this restart is the fix per AGENTS.md.)

- [ ] **Step 4: Verify existing data is intact + null bookId create works**

Run:
```bash
npx tsx -e "import {db} from './src/server/db'; (async()=>{ const any = await db.discussion.findFirst(); console.log('existing ok:', !!any); const s = await db.discussion.create({data:{userId: any!.userId, bookId: null, type:'shelf', language:'en', tier:'admin'}}); console.log('shelf create ok:', s.id, 'bookId=', s.bookId); await db.discussion.delete({where:{id:s.id}}); process.exit(0); })()"
```
Expected: prints `existing ok: true` then `shelf create ok: <id> bookId= null`. If the create fails on a NOT NULL constraint, the migration didn't apply — re-run Step 2.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): make Discussion.bookId nullable for shelf-type discussions"
```

---

### Task 2: `ContextSourceStrategy` interface + types

**Files:**
- Create: `src/server/services/shelf-knowledge/types.ts`

**Interfaces:**
- Produces: `ContextSourceStrategy` (the Plan 2 toggle's home), `ShelfLlmConfig`, and `OkfConcept` (the JSON shape the engine will emit). Plan 1 only uses `ContextSourceStrategy` + `ShelfLlmConfig`; `OkfConcept` is defined now so Plan 2 doesn't reshape the module.

- [ ] **Step 1: Create the types module**

`src/server/services/shelf-knowledge/types.ts`:
```ts
import type { BuiltPrompt } from "@/server/services/prompt-builder";

/**
 * A context source backs a "shelf" discussion. Given the user's question and
 * their accessible book set, it returns a BuiltPrompt whose prompt/sourceText
 * the normal streamChat flow consumes — identical shape to book/section/passage,
 * so nothing downstream of prompt assembly changes.
 *
 * Stage 1 ships OkfContextSource (Plan 2). Stage 2 adds RagContextSource; the
 * admin OKF/RAG toggle selects which instance getContextSource() returns.
 */
export interface ContextSourceStrategy {
  /** Whether the backing knowledge base is built and ready to answer. */
  isReady(): Promise<boolean>;
  /**
   * Build the system context for one turn. `accessibleBookIds` is the user's
   * UserBookAccess-derived set; the source MUST only draw from those books.
   */
  buildContext(args: {
    question: string;
    userId: string;
    accessibleBookIds: string[];
  }): Promise<BuiltPrompt>;
}

export interface ShelfLlmConfig {
  apiKey: string;
  model: string;
}

// ponytail: JSON the LLM emits during compile (Plan 2). The script renders
// markdown from this — the LLM never writes markdown directly, so dangling
// links are impossible by construction. Defined here so Plan 2 doesn't move it.
export interface OkfConcept {
  conceptType: string;          // "theme" | "character" | "argument" | ...
  title: string;
  bodyFields: Record<string, string>;
  relatedConceptNames: string[];// resolved to valid links by the renderer
  sourceBookId: string;
  topic: string;
  form: "narrative" | "nonfiction" | "unknown";
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(shelf-knowledge): add ContextSourceStrategy interface + types"
```

---

### Task 3: `getShelfLlmConfig()` — admin key + model override

**Files:**
- Create: `src/server/services/shelf-knowledge/config.ts`
- Test: `src/server/services/shelf-knowledge/__tests__/config.test.ts`

**Interfaces:**
- Consumes: `getOpenRouterConfig(userType)` (`openrouter.ts:55`) → `{apiKey, model}`; `getSetting(key)` (`settings.ts:7`).
- Produces: `getShelfLlmConfig(): Promise<ShelfLlmConfig>` — "use the Admin key by default"; the model is the admin-tier model unless `AppSetting.shelfKnowledgeModel` overrides it.

- [ ] **Step 1: Write the failing test**

`src/server/services/shelf-knowledge/__tests__/config.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));

vi.mock("@/server/services/openrouter", () => ({
  getOpenRouterConfig: vi.fn(),
}));

vi.mock("@/server/services/settings", () => ({
  getSetting: vi.fn(),
}));

import { getShelfLlmConfig } from "../config";
import { getOpenRouterConfig } from "@/server/services/openrouter";
import { getSetting } from "@/server/services/settings";

describe("getShelfLlmConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the admin-tier key and model by default", async () => {
    vi.mocked(getOpenRouterConfig).mockResolvedValue({
      apiKey: "admin-key",
      model: "anthropic/claude-sonnet-4.6",
    });
    vi.mocked(getSetting).mockResolvedValue(null);

    const cfg = await getShelfLlmConfig();
    expect(cfg.apiKey).toBe("admin-key");
    expect(cfg.model).toBe("anthropic/claude-sonnet-4.6");
    expect(getOpenRouterConfig).toHaveBeenCalledWith("admin");
    expect(getSetting).toHaveBeenCalledWith("shelfKnowledgeModel");
  });

  it("overrides the model when shelfKnowledgeModel AppSetting is set", async () => {
    vi.mocked(getOpenRouterConfig).mockResolvedValue({
      apiKey: "admin-key",
      model: "default-model",
    });
    vi.mocked(getSetting).mockResolvedValue("qwen/qwen3-235b-a22b");

    const cfg = await getShelfLlmConfig();
    expect(cfg.apiKey).toBe("admin-key");       // key always admin
    expect(cfg.model).toBe("qwen/qwen3-235b-a22b"); // overridden
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/services/shelf-knowledge/__tests__/config.test.ts`
Expected: FAIL — `config.ts` does not exist.

- [ ] **Step 3: Implement**

`src/server/services/shelf-knowledge/config.ts`:
```ts
import { getOpenRouterConfig } from "@/server/services/openrouter";
import { getSetting } from "@/server/services/settings";
import type { ShelfLlmConfig } from "./types";

/**
 * Resolve the LLM config the shelf-knowledge engine uses for compile + query.
 * Uses the ADMIN-tier key always ("use the Admin key by default"); the model is
 * the admin-tier model unless the AppSetting `shelfKnowledgeModel` overrides it.
 * The override is surfaced in the admin panel (Plan 3).
 */
export async function getShelfLlmConfig(): Promise<ShelfLlmConfig> {
  const admin = await getOpenRouterConfig("admin");
  const override = await getSetting("shelfKnowledgeModel");
  return { apiKey: admin.apiKey, model: override ?? admin.model };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/services/shelf-knowledge/__tests__/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shelf-knowledge): getShelfLlmConfig — admin key + model override"
```

---

### Task 4: `getAccessibleBookIds(userId)` — the shelf access set

**Files:**
- Create: `src/server/services/shelf-knowledge/access.ts`
- Test: `src/server/services/shelf-knowledge/__tests__/access.test.ts`

**Interfaces:**
- Consumes: `db.userBookAccess`, `db.epubFile`.
- Produces: `getAccessibleBookIds(userId): Promise<string[]>` — every `EpubFile.id` the user may see (rows in `UserBookAccess` PLUS books they uploaded). Every shelf flow threads this through `buildContext` so answers never draw from books the user can't access.

- [ ] **Step 1: Write the failing test**

`src/server/services/shelf-knowledge/__tests__/access.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    userBookAccess: { findMany: vi.fn() },
    epubFile: { findMany: vi.fn() },
  },
}));

import { getAccessibleBookIds } from "../access";
import { db } from "@/server/db";

describe("getAccessibleBookIds", () => {
  it("unions UserBookAccess bookIds and the user's uploaded books", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([
      { bookId: "b1" },
      { bookId: "b2" },
    ] as any);
    vi.mocked(db.epubFile.findMany).mockResolvedValue([
      { id: "b3" },
    ] as any);

    const ids = await getAccessibleBookIds("u1");
    expect(ids.sort()).toEqual(["b1", "b2", "b3"]);

    expect(db.userBookAccess.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: { bookId: true },
    });
    expect(db.epubFile.findMany).toHaveBeenCalledWith({
      where: { uploadedById: "u1" },
      select: { id: true },
    });
  });

  it("dedupes when a book appears in both sets", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([
      { bookId: "b1" },
    ] as any);
    vi.mocked(db.epubFile.findMany).mockResolvedValue([
      { id: "b1" },
    ] as any);
    const ids = await getAccessibleBookIds("u1");
    expect(ids).toEqual(["b1"]);
  });

  it("returns [] for a user with no books", async () => {
    vi.mocked(db.userBookAccess.findMany).mockResolvedValue([]);
    vi.mocked(db.epubFile.findMany).mockResolvedValue([]);
    const ids = await getAccessibleBookIds("u1");
    expect(ids).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/services/shelf-knowledge/__tests__/access.test.ts`
Expected: FAIL — `access.ts` does not exist.

- [ ] **Step 3: Implement**

`src/server/services/shelf-knowledge/access.ts`:
```ts
import { db } from "@/server/db";

/**
 * Every book id a user may draw shelf-discussion answers from: the union of
 * their UserBookAccess grants and the books they uploaded. Mirrors the access
 * rule in verifyBookAccess (reader.ts) but returns the full set instead of a
 * boolean — shelf retrieval filters its corpus through this list.
 */
export async function getAccessibleBookIds(userId: string): Promise<string[]> {
  const [granted, uploaded] = await Promise.all([
    db.userBookAccess.findMany({
      where: { userId },
      select: { bookId: true },
    }),
    db.epubFile.findMany({
      where: { uploadedById: userId },
      select: { id: true },
    }),
  ]);
  const set = new Set<string>();
  for (const g of granted) set.add(g.bookId);
  for (const u of uploaded) set.add(u.id);
  return [...set];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/services/shelf-knowledge/__tests__/access.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shelf-knowledge): getAccessibleBookIds — shelf access set"
```

---

### Task 5: Stub `ContextSourceStrategy` + factory

**Files:**
- Create: `src/server/services/shelf-knowledge/context-source.ts`

**Interfaces:**
- Produces: `getContextSource(): ContextSourceStrategy`. Plan 1 returns `StubContextSource` (clearly marked; `isReady()` true; `buildContext()` returns a BuiltPrompt whose prompt is an honest "engine not connected yet" system message). Plan 2 swaps in `OkfContextSource` behind the same factory — that's the toggle's home.

- [ ] **Step 1: Create the factory + stub**

`src/server/services/shelf-knowledge/context-source.ts`:
```ts
import type { BuiltPrompt } from "@/server/services/prompt-builder";
import type { ContextSourceStrategy } from "./types";

/**
 * ponytail: Plan 1 stub. Returns an honest "engine not connected" system prompt
 * so the full shelf-discussion plumbing (create → persist → stream → list →
 * follow-up) is testable end-to-end before the OKF engine (Plan 2) exists.
 * The first answer will explain the feature is wired but awaiting the engine.
 *
 * Plan 2 replaces the returned instance with OkfContextSource; Plan 3's admin
 * toggle selects between OKF/RAG here. Callers never change.
 */
class StubContextSource implements ContextSourceStrategy {
  async isReady(): Promise<boolean> {
    return true;
  }
  async buildContext(args: {
    question: string;
    userId: string;
    accessibleBookIds: string[];
  }): Promise<BuiltPrompt> {
    const n = args.accessibleBookIds.length;
    const systemPrompt = [
      "You are Nutshell's 'ask your bookshelf' assistant.",
      "The whole-library knowledge engine is wired but not yet connected (stub context).",
      `The reader has ${n} book${n === 1 ? "" : "s"} on their shelf.`,
      "Answer their question helpfully and briefly, and note that full shelf-wide answers arrive once the knowledge base is built.",
    ].join("\n");
    return {
      prompt: systemPrompt,
      sourceText: "",   // stub: no compiled knowledge yet
      bookText: "",
      // ponytail: synthetic md5 — shelf discussions don't use the explainer
      // cache (like blank discussions), so this only feeds a hash that's never
      // looked up. Hashing the user id keeps per-user rows distinct.
      bookMd5: `shelf:${args.userId}`,
      promptVersion: 1,
    };
  }
}

export function getContextSource(): ContextSourceStrategy {
  // Plan 2: return new OkfContextSource();  Plan 3: select on AppSetting.
  return new StubContextSource();
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(shelf-knowledge): stub ContextSourceStrategy + factory"
```

---

### Task 6: Service seams — `"shelf"` branch + `streamShelfFirstTurn`

**Files:**
- Modify: `src/server/services/discussions.ts` (type literals at `:71` & `:360`; `buildPromptData` at `:359`; `rebuildSystemPrompt` at `:985`; new `streamShelfFirstTurn` added near `streamBlankFirstTurn` at `:1153`)

**Interfaces:**
- Consumes: `getContextSource()` (Task 5), `getAccessibleBookIds` (Task 4), `getShelfLlmConfig` (Task 3), `streamChat`/`OpenRouterError` from `./openrouter`.
- Produces: `streamShelfFirstTurn({userId, language, tier, userMessage})` (the shelf analog of `streamBlankFirstTurn`, book-less); `"shelf"` accepted by `buildPromptData` and `rebuildSystemPrompt`.

- [ ] **Step 1: Widen the type literals**

In `src/server/services/discussions.ts`:

At `CreateDiscussionParams` (line ~71) change:
```ts
  type: "passage" | "section" | "book";
```
to:
```ts
  type: "passage" | "section" | "book" | "shelf";
```

In `buildPromptData`'s param type (line ~360) change:
```ts
  type: "passage" | "section" | "book";
```
to:
```ts
  type: "passage" | "section" | "book" | "shelf";
```

- [ ] **Step 2: Add the `"shelf"` branch to `buildPromptData`**

Inside `buildPromptData` (function starts at `:359`), after the `if (type === "section") {...}` block and before the `// book` fallback (`:392`), insert:

```ts
  if (type === "shelf") {
    // ponytail: shelf discussions don't build context from a single book — the
    // ContextSourceStrategy owns it. buildPromptData is shared with reroll,
    // which is book-scoped, so we throw here if ever hit (reroll has no shelf
    // path). The live shelf flows call the strategy directly via
    // streamShelfFirstTurn / rebuildSystemPrompt, not through here.
    throw new Error("shelf discussions build context via ContextSourceStrategy, not buildPromptData");
  }
```

- [ ] **Step 3: Add the `"shelf"` branch to `rebuildSystemPrompt`**

`rebuildSystemPrompt` (at `:985`) currently takes `(discussion: {type; bookId; language; passageText; sectionHref})`. It's called from `streamFollowup` (`:922`) as `rebuildSystemPrompt(discussion)`. Widen it to optionally accept the current user message (shelf context is per-turn), then add the shelf branch.

Change the signature + body. Replace the function declaration:

```ts
async function rebuildSystemPrompt(discussion: {
  type: string;
  bookId: string;
  language: string;
  passageText: string | null;
  sectionHref: string | null;
}): Promise<string> {
```

with:

```ts
async function rebuildSystemPrompt(
  discussion: {
    type: string;
    bookId: string | null;
    language: string;
    passageText: string | null;
    sectionHref: string | null;
    userId: string;
  },
  currentUserMessage?: string
): Promise<string> {
```

Then, immediately after the opening `{` of the function body (before `if (discussion.type === "passage")`), insert the shelf branch:

```ts
  if (discussion.type === "shelf") {
    const { getContextSource } = await import("./shelf-knowledge/context-source");
    const { getAccessibleBookIds } = await import("./shelf-knowledge/access");
    const accessibleBookIds = await getAccessibleBookIds(discussion.userId);
    const ctx = await getContextSource().buildContext({
      question: currentUserMessage ?? "",
      userId: discussion.userId,
      accessibleBookIds,
    });
    return ctx.prompt;
  }
```

- [ ] **Step 4: Thread the current user message into the follow-up call**

In `streamFollowup`, the call at `:922` is:
```ts
  const systemPrompt = await rebuildSystemPrompt(discussion);
```
Change it to pass the current question:
```ts
  const systemPrompt = await rebuildSystemPrompt(discussion, params.userMessage);
```
(`discussion` here is the Prisma row which includes `userId`, so the widened `userId` field is satisfied.)

- [ ] **Step 5: Add `streamShelfFirstTurn`**

Append this new exported function at the end of `discussions.ts` (after `streamBlankFirstTurn`, which ends at `:1254`). It mirrors `streamBlankFirstTurn` but: no `bookId`, type `"shelf"`, context from the strategy, config from `getShelfLlmConfig`, and no `FOLLOWUP_CITATION_SUFFIX` (shelf answers cite source books, not chapter hrefs — that's Plan 3):

```ts
export interface ShelfFirstTurnEvent {
  type: "discussion" | "chunk" | "error" | "done";
  discussionId?: string;
  chunk?: string;
  error?: string;
}

/**
 * Start a shelf-scoped discussion: create a discussion with NO book and NO
 * explainer, then answer the user's opening question using context from the
 * ContextSourceStrategy (OKF in Plan 2; stub in Plan 1). The book-less analog
 * of streamBlankFirstTurn. Emits the new discussionId up front so the client
 * can pin it, then streams the assistant reply.
 */
export async function* streamShelfFirstTurn(params: {
  userId: string;
  language: string;
  tier: "regular" | "pro" | "admin";
  userMessage: string;
}): AsyncGenerator<ShelfFirstTurnEvent> {
  const { userId, language, tier, userMessage } = params;

  const { getContextSource } = await import("./shelf-knowledge/context-source");
  const { getAccessibleBookIds } = await import("./shelf-knowledge/access");
  const { getShelfLlmConfig } = await import("./shelf-knowledge/config");

  const source = getContextSource();
  // ponytail: surface "not ready" as a clean error event rather than a 500 —
  // e.g. wiki not yet built (Plan 2). Stub is always ready.
  if (!(await source.isReady())) {
    yield { type: "error", error: "The bookshelf knowledge base isn't built yet. An admin can build it from the admin panel." };
    return;
  }

  const accessibleBookIds = await getAccessibleBookIds(userId);
  if (accessibleBookIds.length === 0) {
    yield { type: "error", error: "Add a book to your shelf first, then ask again." };
    return;
  }

  // Shelf discussion: no book, no explainer, no cache key, no passage/section.
  const discussion = await db.discussion.create({
    data: { userId, bookId: null, type: "shelf", language, tier },
  });
  yield { type: "discussion", discussionId: discussion.id };

  await db.discussionMessage.create({
    data: { discussionId: discussion.id, role: "user", content: userMessage },
  });

  const ctx = await source.buildContext({ question: userMessage, userId, accessibleBookIds });

  const { apiKey, model } = await getShelfLlmConfig();
  if (!apiKey) {
    yield { type: "error", error: "OpenRouter API key not configured" };
    return;
  }

  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: ctx.prompt },
    { role: "user", content: userMessage },
  ];

  const { streamChat } = await import("./openrouter");
  let fullContent = "";
  try {
    for await (const chunk of streamChat({ apiKey, model, messages })) {
      fullContent += chunk;
      yield { type: "chunk", chunk };
    }
  } catch (err: any) {
    const message = err instanceof OpenRouterError ? err.message : "Generation failed";
    yield { type: "error", error: message };
    return;
  }

  await db.discussionMessage.create({
    data: { discussionId: discussion.id, role: "assistant", content: fullContent, modelId: model },
  });
  await db.discussion.update({ where: { id: discussion.id }, data: { updatedAt: new Date() } });

  yield { type: "done" };
}
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (If `rebuildSystemPrompt`'s call sites complain about the new `userId` field — the Prisma `discussion` row includes `userId`, so the widened type is satisfied at every callsite.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(discussions): shelf-type branch + streamShelfFirstTurn"
```

---

### Task 7: API route — accept `type:"shelf"`, optional `bookId`

**Files:**
- Modify: `src/app/api/discussions/route.ts:27-193` (the `POST` handler)

**Interfaces:**
- Consumes: `streamShelfFirstTurn` (Task 6), `getAccessibleBookIds` (Task 4 — not strictly needed in the route since the service derives it, but the access *decision* moves from `verifyBookAccess(bookId)` to "user is authed"; shelf access is enforced inside the strategy via the book-id set).
- Produces: `POST /api/discussions` accepts `{type:"shelf", message, language?}` (no `bookId`) and streams the shelf first turn.

- [ ] **Step 1: Widen the body type + allow shelf**

In `src/app/api/discussions/route.ts`, the destructured body type (lines ~40-49) currently has:
```ts
    } as {
      bookId?: string;
      type?: "passage" | "section" | "book";
```
Change the `type` line to:
```ts
      type?: "passage" | "section" | "book" | "shelf";
```

- [ ] **Step 2: Replace the validation + access block**

The current block (lines ~51-67) is:
```ts
    if (!bookId || !type) {
      return sseError("bookId and type are required", 400);
    }
    if (!["passage", "section", "book"].includes(type)) {
      return sseError("type must be passage, section, or book", 400);
    }
    // Seeded-mode field validation (runs before the access check so a bad
    // request is 400, not 403 — matches existing endpoint contract).
    if (type === "passage" && !passageText) {
      return sseError("passageText is required for passage type", 400);
    }
    if (type === "section" && !sectionHref) {
      return sseError("sectionHref is required for section type", 400);
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) return sseError("Access denied", 403);
```

Replace it with:
```ts
    if (!type) {
      return sseError("type is required", 400);
    }
    if (!["passage", "section", "book", "shelf"].includes(type)) {
      return sseError("type must be passage, section, book, or shelf", 400);
    }
    // ponytail: shelf discussions are book-less — no single bookId, no
    // verifyBookAccess. Per-book access is enforced inside the context source
    // via the user's UserBookAccess-derived set (see getAccessibleBookIds).
    if (type !== "shelf") {
      if (!bookId) {
        return sseError("bookId is required for passage/section/book types", 400);
      }
      if (type === "passage" && !passageText) {
        return sseError("passageText is required for passage type", 400);
      }
      if (type === "section" && !sectionHref) {
        return sseError("sectionHref is required for section type", 400);
      }
      const hasAccess = await verifyBookAccess(user.id, bookId);
      if (!hasAccess) return sseError("Access denied", 403);
    }
```

- [ ] **Step 3: Route shelf into its own streaming branch**

The current blank-mode branch (lines ~104-148) begins:
```ts
    // Blank "New discussion" first turn — no explainer generation.
    if (message !== undefined) {
      if (typeof message !== "string" || !message.trim()) {
        return sseError("message must be a non-empty string", 400);
      }
      if (type !== "book") {
        return sseError("blank discussions are book-level only", 400);
      }
```

Change the `type !== "book"` check to also permit shelf, and add a shelf branch. Replace:
```ts
      if (type !== "book") {
        return sseError("blank discussions are book-level only", 400);
      }
      const encoder = new TextEncoder();
```
with:
```ts
      if (type !== "book" && type !== "shelf") {
        return sseError("blank discussions are book- or shelf-level only", 400);
      }

      // Shelf discussions have their own book-less first-turn stream.
      if (type === "shelf") {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              const { streamShelfFirstTurn } = await import(
                "@/server/services/discussions"
              );
              for await (const event of streamShelfFirstTurn({
                userId: user.id,
                language: preferredLanguage,
                tier,
                userMessage: message,
              })) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
                );
                if (event.type === "error") break;
              }
              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
              controller.close();
            } catch (err: any) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "error", error: err.message || "Generation failed" })}\n\n`
                )
              );
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      }

      const encoder = new TextEncoder();
```
(The existing book-blank streaming block that follows continues unchanged.)

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): POST /api/discussions accepts shelf type (no bookId)"
```

---

### Task 8: `DiscussionListItem.book` optional + DiscussionsHomeView shelf row + create mutation

**Files:**
- Modify: the `DiscussionListItem` type definition (locate via the import in `discussions-home.tsx` — `@/types/discussion` per the UI map)
- Modify: `src/components/library/discussions-home.tsx` (row rendering `:247-329`, type chip `:352-357`, add a create mutation + `onCreateShelfDiscussion` prop)
- Modify: `src/components/library/home-view.tsx` (bar input `:194-199`, placeholder; add Enter handler + state)

**Interfaces:**
- Consumes: `POST /api/discussions` with `{type:"shelf", message}` (Task 7); `["discussions-all"]` query key.
- Produces: typing in the bar + Enter creates a shelf discussion, switches to the Discussions tab, and the new discussion appears as a book-less row.

> **Read first:** before editing, read `src/types/discussion.ts` (the `DiscussionListItem` definition), and re-read the exact current lines of `discussions-home.tsx` around 247-360, 667-776, and the component props/exports. Line numbers below are from the integration map and may have drifted by a line or two; trust the function/identifier names, re-confirm offsets before each edit.

- [ ] **Step 1: Make `DiscussionListItem.book` optional**

In `src/types/discussion.ts`, change the `book` field on `DiscussionListItem` from required to optional (`book?: { ... }`). The shape stays the same; only optionality changes. This is the type-level change that lets a shelf row exist.

- [ ] **Step 2: Add the shelf branch to the row + type chip in `discussions-home.tsx`**

In `DiscussionRow` (`:247-329`), the row currently assumes `d.book` is present (title at `:294-296`, cover at `:311-316`). Wrap the book-dependent rendering in a branch. At the top of the component body (where `involvedTitles` is computed, ~`:275`), add a flag:

```tsx
  const isShelf = d.type === "shelf";
```

Replace the `<h3>` title block (`:294-296`) so a shelf row shows the user's opening question instead of a book title:

```tsx
        <h3 className="truncate font-serif text-base font-medium text-espresso">
          {isShelf
            ? (d.messages?.[0]?.content ?? "Ask your bookshelf")
            : isMulti
              ? booksLabel(involvedTitles)
              : d.book?.title ?? "Untitled"}
        </h3>
```
(If `d.messages` isn't on the list type today, fall back to the literal `"Ask your bookshelf"` — confirm via the `GET /api/discussions` response shape; the detail already carries messages, the list may not. If the list doesn't include the first message, use the literal for now and refine in Plan 3.)

Replace the cover block (`:310-326`) so a shelf row shows a `Library` icon instead of a `BookCover`:

```tsx
      <div className={"flex shrink-0" + (isMulti ? " gap-1" : "")}>
        {isShelf ? (
          <div className="flex h-14 w-10 items-center justify-center rounded bg-muted text-muted-foreground">
            <Library className="h-5 w-5" />
          </div>
        ) : (
          <>
            <BookCover coverPath={d.book?.coverPath} title={d.book?.title ?? ""} className="h-14 w-10 rounded" cover />
            {attachedBooks.map((a) => (<BookCover key={a.id} coverPath={a.coverPath} title={a.title} className="h-14 w-10 rounded" cover />))}
          </>
        )}
      </div>
```

Add the import `Library` to the existing `lucide-react` import at the top of the file.

In the type chip (`:352-357`), add a shelf case:
```tsx
        {d.type === "shelf" && <Library className="h-3 w-3" />}
```
inserted alongside the existing `passage`/`section`/`book` icon lines.

Also guard `involvedTitles` (`:275`) so it doesn't crash on a missing book:
```tsx
  const involvedTitles = [d.book?.title, ...attachedBooks.map((a) => a.title)].filter(
    (t): t is string => !!t
  );
```

- [ ] **Step 3: Add a create mutation + `onCreateShelfDiscussion` prop**

`discussions-home.tsx` does not import `useMutation` today. Add a create function mirroring the `sendFollowup` plain-fn + `invalidateQueries` pattern (the UI map confirmed `sendFollowup` at `:667` invalidates `["discussions-all"]` at `:762-763`).

On the `DiscussionsHomeView` component, add a prop:
```tsx
  onCreateShelfDiscussion: (question: string) => Promise<void>;
```

Inside the component (it already has `useQueryClient` via the map), add:
```tsx
  const createShelfDiscussion = async (question: string) => {
    const res = await fetch("/api/discussions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "shelf", message: question }),
    });
    if (!res.ok) throw new Error("Failed to create shelf discussion");
    // ponytail: the SSE response streams the first answer; for the list we just
    // invalidate so the new row appears. Plan 3 wires the detail-open + stream
    // consumption so the user lands inside the new thread watching it stream.
    await queryClient.invalidateQueries({ queryKey: ["discussions-all"] });
  };
```

Wire the prop through: `createShelfDiscussion` becomes the value passed for `onCreateShelfDiscussion`. (The component owns `useQueryClient`, so this is the right home — confirms the UI map's recommendation.)

- [ ] **Step 4: Wire the bar input in `home-view.tsx`**

In `src/components/library/home-view.tsx`:

Add state near the other `useState` calls (e.g. near `:128`):
```tsx
  const [shelfQuery, setShelfQuery] = useState("");
```

Change the `<input>` at `:194-199` — add `value`, `onChange`, `onKeyDown`, and change the placeholder:
```tsx
                    <input
                      type="search"
                      aria-label="Ask your books"
                      placeholder="Ask your books…"
                      value={shelfQuery}
                      onChange={(e) => setShelfQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const q = shelfQuery.trim();
                          if (!q) return;
                          e.preventDefault();
                          void onCreateShelfDiscussion(q).then(() => {
                            setShelfQuery("");
                            setTabValue("explainers");
                          });
                        }
                      }}
                      className="flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted-foreground/70"
                    />
```

`onCreateShelfDiscussion` must reach `home-view.tsx`. Two options — pick the cleaner given `HomeViewProps` (`:46-59`): add `onCreateShelfDiscussion` to `HomeViewProps`, and in the server-component parent (`src/app/(library)/my-library/page.tsx`) pass a stable callback. BUT the create needs `useQueryClient` which lives in `DiscussionsHomeView`. **Recommended:** expose `onCreateShelfDiscussion` from `DiscussionsHomeView` upward by lifting the callback: have `DiscussionsHomeView` accept an `onAskReady` ref/callback that registers its `createShelfDiscussion`, OR simpler — since `home-view.tsx` renders `<DiscussionsHomeView>` (`:215`), pass a callback *down* that `DiscussionsHomeView` ignores and instead move the `useQueryClient` + create logic up to a shared parent.

**Simplest correct wiring (Ponytail):** move the create fetch + invalidate into `home-view.tsx` itself by giving `home-view.tsx` access to the query client. Add `import { useQueryClient } from "@tanstack/react-query"` to `home-view.tsx`, and inline the create:
```tsx
  const queryClient = useQueryClient();
  const onCreateShelfDiscussion = async (question: string) => {
    const res = await fetch("/api/discussions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "shelf", message: question }),
    });
    if (!res.ok) throw new Error("Failed to create shelf discussion");
    await queryClient.invalidateQueries({ queryKey: ["discussions-all"] });
  };
```
Drop the `onCreateShelfDiscussion` prop from `DiscussionsHomeView` (Step 3's prop is then unused — remove it to avoid a dangling interface). `["discussions-all"]` is the shared list key, so invalidating from `home-view.tsx` refreshes `DiscussionsHomeView`'s list correctly. (Decide between Step 3's prop-lifting vs this inline approach; the inline one is fewer moving parts and is recommended.)

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If the unused-prop variant was chosen, ensure no unused-variable lint error.

- [ ] **Step 6: Manual smoke test**

Start the dev server (`npm run dev`), sign in as a user with ≥1 book, go to `/my-library`, type a question into the bar, press Enter. Expected: the field clears, the Discussions tab activates, and a new row appears with the `Library` icon. Clicking it opens the thread; the streamed answer notes the engine is a stub (per Task 5). Follow-ups stream too.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(library): ask-your-bookshelf bar → shelf discussion (stub engine)"
```

---

### Task 9: Full-suite green + Plan 1 milestone verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all green, including the two new shelf-knowledge test files and the existing discussions tests (the nullable `bookId` must not regress anything).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Verify the Plan 1 milestone end-to-end**

Confirm all of:
1. A shelf discussion can be created from the bar, persists with `bookId IS NULL` and `type = 'shelf'`, and appears in the Discussions tab.
2. The first turn streams (stub context) and the assistant reply persists as a `DiscussionMessage`.
3. A follow-up in that thread streams (exercises the `rebuildSystemPrompt` shelf branch).
4. Existing book/section/passage discussions are unchanged (regression check).
5. `getShelfLlmConfig` honors an `AppSetting.shelfKnowledgeModel` override (set it via `npx tsx -e "..."` calling `setSetting`, confirm the model used).

- [ ] **Step 4: Commit any fixups, then note completion**

```bash
git add -A && git commit -m "chore: plan 1 milestone green" --allow-empty
```

---

## Self-Review

**Spec coverage (Plan 1 scope — foundation only):**
- Schema: nullable bookId + shelf type → Task 1 ✓
- `ContextSourceStrategy` interface (toggle plumbing) → Task 2 ✓
- `getShelfLlmConfig` (admin key + override) → Task 3 ✓
- Access filtering derivation → Task 4 ✓
- Stub source (engine deferred) → Task 5 ✓
- 3 service seams + `streamShelfFirstTurn` → Task 6 ✓
- API `type:"shelf"`, optional bookId, shelf-scope access → Task 7 ✓
- Bar wiring + placeholder + book-less row → Task 8 ✓

Plan 1 deliberately defers (covered by Plan 2/3, out of scope here): the OKF engine compile/query, embeddings, the admin panel UI, the build trigger, citations rendering, incremental rebuild on upload. These are called out in the spec's Stage-1 success gate and will be Plan 2 (engine) + Plan 3 (admin + citations) — each producing its own working, testable increment on top of this skeleton.

**Placeholder scan:** Task 8's row-title falls back to a literal if the list payload lacks the first message (flagged inline with a concrete fallback, not a TBD). Task 8 offers two wiring approaches with a clear recommendation — both are fully specified, not "decide later." No TBD/TODO/"add error handling" anywhere.

**Type consistency:** `ContextSourceStrategy.buildContext({question, userId, accessibleBookIds})` is identical across types.ts (Task 2), the stub (Task 5), and the service seams (Task 6). `ShelfLlmConfig` matches between types.ts and config.ts. `streamShelfFirstTurn`'s event shape (`ShelfFirstTurnEvent`) matches what the route (Task 7) JSON-encodes. `rebuildSystemPrompt`'s widened signature (`bookId: string | null`, added `userId`, optional `currentUserMessage`) is consistent at the definition (Task 6 Step 3) and the callsite (Task 6 Step 4).

**Risk note:** Task 8 touches two large UI files (`discussions-home.tsx` ~1342 lines, `home-view.tsx` 238 lines) whose exact line numbers may have drifted from the integration map. Each edit names the function/identifier and the surrounding code, and Step 1 of Task 8 instructs re-confirming offsets before editing — standard for editing large existing files.

## Subsequent plans (roadmap)

- **Plan 2 — The OKF engine:** `wiki-storage`, `chunker` (reuse `chunkText`), `cache`, `render` (JSON→markdown, dangling-link impossibility, TDD), `cluster`, `extract-concepts`, `synthesize-themes`, `build-wiki` (orchestrator + cost preview), `progressive-disclosure` (query), and the real `OkfContextSource` replacing the stub behind `getContextSource()`.
- **Plan 3 — Admin + citations:** admin "Build shelf wiki" endpoint + the "Shelf Knowledge" panel section (model-override + build trigger + status), incremental rebuild on book upload, source-book citation rendering in shelf answers.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-27-ask-your-bookshelf-stage1-plan1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
