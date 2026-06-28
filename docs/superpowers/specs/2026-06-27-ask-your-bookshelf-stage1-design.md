# Ask Your Bookshelf — Stage 1 (OKF) — Design

**Date:** 2026-06-27
**Status:** Awaiting sign-off
**Scope:** A new "ask your bookshelf" interaction: typing into the existing shelf-bar field and pressing return creates a **shelf-scoped discussion** whose context is drawn from a whole-library knowledge base (compiled once, OKF-style) instead of a single book/section/passage. Stage 1 ships the **OKF** (compile-once wiki) context source only; the RAG context source and the admin OKF/RAG toggle are Stage 2. The OKF pattern is tested against Karpathy's "LLM wiki" idea and Google's Open Knowledge Format, but this design uses the *pattern* (markdown concept files + cross-links + progressive disclosure) — strict OKF-spec conformance is a non-goal.

## Goal

Let a user ask a question of their *entire* bookshelf — across books, by theme — and get an answer synthesized from a pre-compiled, cross-linked knowledge base, in a discussion that persists and can be followed up like any other.

Triggered use case: a user with books on progress, evolution, and economics types *"how do my books disagree about the role of trade in human progress?"* — a question no single book answers and that vanilla query-time RAG is bad at — and gets a cited, cross-book answer that navigated the right concept files rather than loading the whole library.

## User stories

1. As a reader on the bookshelf, I type a question into the "Ask your books…" field, press return, and land on the Discussions tab with a new shelf discussion streaming its first answer.
2. As a reader, the answer draws only from books I have access to (`UserBookAccess`), cites the books/concepts it used, and never invents sources.
3. As a reader, I can follow up in the same shelf discussion; each turn re-navigates the knowledge base for context.
4. As an admin, I trigger the initial whole-shelf wiki build from the admin panel and see its status; adding a new book incrementally updates the wiki without a full rebuild.
5. As an admin, the shelf-knowledge engine uses my admin-tier OpenRouter key/model by default, and I can optionally override the model it uses for compile/query.

## Non-goals (YAGNI / Stage 2)

- **RAG context source.** Stage 2 adds a Qwen3-Embedding-8B (HuggingFace Inference) retrieval path implementing the same `ContextSourceStrategy`.
- **Admin OKF/RAG toggle.** Lives in the `ContextSourceStrategy` slot; only meaningful once both backends exist. Stage 1 ships OKF-only.
- **Blind evaluation harness / question buckets.** The comparative viability verdict (does OKF beat RAG on cross-book synthesis?) is a Stage 2 exercise.
- **Strict OKF-spec conformance.** We use the pattern (markdown + cross-links + index files + permissive consumption). The `type` frontmatter field and `index.md`/reserved-filename conventions are honored where free; spec-precise validation is not built.
- **Live search/autocomplete in the bar.** Stage 1 is "return = ask" only. The placeholder copy drops the "search" over-promise. Search/filter can return later.
- **Per-discussion book attachments for shelf type.** A shelf discussion already spans the user's whole accessible library; explicit attachment is redundant for Stage 1.
- **Re-ranker.** Premature; revisit with Stage 2 retrieval.
- **Per-user wiki compilation.** Books are md5-deduped globally; one global wiki + access-filter at query is strictly cheaper.

## Decisions (resolved)

| Axis | Decision | Why |
|---|---|---|
| Feature shape | Integrated product feature, not an offline spike | The entry point (shelf bar) and home (Discussions tab) already exist; the value is in the live interaction, not a script |
| Context pattern | Compile-once OKF wiki + progressive disclosure (navigate, don't dump) | Books are frozen → the wiki's biggest weakness (staleness) barely applies; cross-book synthesis is the home-turf win |
| Wiki substrate | Raw book text (`EpubFile.txtPath`) | Faithful test of the pattern; not a summary-of-summaries over Explainers |
| Markdown authoring | **LLM emits concept-data-as-JSON → script renders markdown** | Kills the "LLMs botch markdown at scale / invent dangling links" failure mode by construction; links generated only between concept IDs the script actually created |
| Scope | Whole shelf (28 books, ~3.57M tokens) | That *is* the product; a curated subset wouldn't validate it. Tractable: ~$1–20 one-time compile, then cached |
| Cross-book synthesis | Topic-cluster first, then synthesize *within* each cluster (≥2 books) | At whole-shelf scale most books are unrelated; can't feed all concepts to one pass |
| Discussion type | New `"shelf"` type, `bookId` nullable | Cleaner than overloading blank `"book"`; shelf discussions are inherently book-less/multi-book |
| Context seam | New `shelf` branch in 3 callers returning a `BuiltPrompt` from a `ContextSourceStrategy` | Every downstream consumer reads the `BuiltPrompt` shape (`prompt-builder.ts:18-25`); no other code changes for the context source |
| Analog path | The blank "New discussion" flow (`streamBlankFirstTurn`) | Already creates with no explainer and builds context from one call — shelf just swaps that call |
| Access control | Derive user's accessible bookIds from `UserBookAccess`; retrieval filters through them | Clones the proven `validateNewAttachments` loop (`discussions.ts:773-777`) |
| Storage | Markdown files under `STORAGE_PATH/shelf-wiki/` | OKF-native, diff-able, readable via the existing `storage/` adapter |
| Recompile | Admin-triggered initial build + incremental on new upload, content-hash cached | Adding book #29 costs only that book + its cluster |
| LLM config | Default = admin-tier `getOpenRouterConfig("admin")`; optional model override via `AppSetting.shelfKnowledgeModel` | "Use the Admin key by default"; no schema change (KV table); tunable in the admin panel |
| Toggle timing | Defer to Stage 2 | No point toggling with one backend; the strategy interface is the toggle's plumbing |
| Bar behavior | Return = ask only; placeholder → "Ask your books…" | Ships the feature; drops the "search" over-promise until search is built |
| External deps (Stage 1) | None — OpenRouter only | Embeddings/HF endpoint are wholly Stage 2 |
| Multilingual | Concepts extracted cross-language; answers link by meaning (FR/ES books present) | OpenRouter LLMs handle cross-language; concept files carry source-language metadata |

## Architecture

### The context-source strategy (the Stage 2 toggle's home)

A single interface both backends implement:

```ts
// src/server/services/shelf-knowledge/types.ts
interface ContextSourceStrategy {
  buildContext(question: string, userId: string): Promise<BuiltPrompt>;
}
```

`BuiltPrompt` is the existing contract (`prompt-builder.ts:18-25`: `{ prompt, sourceText, bookText, bookMd5, promptVersion, metadataVersion? }`). Stage 1: `OkfContextSource` implements it. Stage 2: `RagContextSource` implements the same interface; the admin toggle selects which instance the factory returns. `bookMd5` for a shelf context is a synthetic key (e.g. hash of the OKF query) — it only feeds `computeExplainerContentHash` (`explainer.ts:53`), which shelf discussions don't use (no explainer cache, like today's blank path).

### The engine — `src/server/services/shelf-knowledge/`

```
shelf-knowledge/
├── types.ts                 # ContextSourceStrategy, OkfConcept (JSON), BuiltPrompt wiring
├── config.ts                # getShelfLlmConfig(): admin-tier key + AppSetting model override
├── okf-context-source.ts    # implements ContextSourceStrategy (progressive-disclosure query)
├── compile/
│   ├── extract-concepts.ts  # per-book: chunk → LLM JSON concepts (branch on isNarrative) → merge
│   ├── cluster.ts           # group books by topic tag (script-side)
│   ├── synthesize-themes.ts # per-cluster cross-book theme files (JSON → render)
│   ├── render.ts            # JSON concept-data → markdown files (zero dangling links)
│   └── build-wiki.ts        # orchestrates compile; writes under STORAGE_PATH/shelf-wiki/
├── query/
│   └── progressive-disclosure.ts  # root index → cluster(s) → concept file(s) → answer
└── .cache/                  # content-hash-keyed LLM JSON outputs (free re-runs)
```

**Compile pipeline** (`build-wiki.ts`):
1. **Per-book extraction** (`extract-concepts.ts`): chunk raw `txtPath` text (reuse `chunkText`, `src/lib/tts/chunk.ts:68`); per chunk, an LLM call returns concept-*data-as-JSON* — `{ conceptType, title, bodyFields, relatedConceptNames, sourceBookId, topic, form }`. Branch the extraction template on `BookMetadata.isNarrative` (`schema.prisma:169`): fiction → characters/themes/settings; nonfiction → arguments/frameworks/evidence/key concepts. For the 6 books with no `BookMetadata`, the LLM infers `form`/`topic` and the result backfills the missing metadata. Merge/dedupe concepts per book.
2. **Cluster** (`cluster.ts`): group books by their `topic` tag — pure script logic, no LLM.
3. **Cross-book synthesis** (`synthesize-themes.ts`): for each cluster with ≥2 books, one LLM call (JSON in, JSON out) produces cross-cutting theme concepts that reference the per-book concepts.
4. **Render** (`render.ts`): write markdown files — per-book concept files, per-cluster theme files, hierarchical `index.md` (root → cluster → book). **Links are generated by the script only between concept IDs that exist**, so dangling links are impossible and formatting is uniform.

**Query pipeline** (`progressive-disclosure.ts`, called by `OkfContextSource.buildContext`):
1. Access-filter: derive the user's bookIds from `UserBookAccess`, restrict the visible wiki to concepts whose `sourceBookId` is in that set.
2. Navigate: an LLM call reads the (filtered) root `index.md` + cluster indexes (small), picks 1–3 concept file IDs to open.
3. Read + answer: a second call reads those concept files and produces the answer with source-book citations.
4. Returns a `BuiltPrompt` whose `sourceText`/`bookText` carry the navigated concept content + answer, fed into the normal `streamChat` flow.

### The shelf discussion type + schema changes

`Discussion` (`schema.prisma:384-411`) changes:
- `bookId String?` (was `String`, NOT NULL) — `schema.prisma:387`
- `book EpubFile? @relation(...)` — optional relation — `schema.prisma:404`
- `@@index([userId, bookId])` remains valid with nulls.
- `type` gains `"shelf"` (app-level allowlists only; no SQLite enum exists — see `data-model.md:7`).

This is a Prisma migration on the most-depended model in the codebase. **After `db:generate`/`db:push`, the running `npm run dev` server MUST be restarted** (`node_modules` Prisma client is cached in memory; new nullable column = silent 500s otherwise). Use `scripts/dev.sh` (the `learnop-bust-next-after-prisma-generate` skill exists for exactly this).

### Integration — the 7 blockers, resolved

| # | Blocker | Location | Fix |
|---|---|---|---|
| 1 | `Discussion.bookId` NOT NULL + required FK | `schema.prisma:387,404` | Migration: nullable + optional relation (above) |
| 2 | API requires `bookId`+`type`; validates `type` allowlist | `route.ts:51-56` | Allow `type:"shelf"`; make `bookId` optional when shelf |
| 3 | Blank mode requires `type === "book"` | `route.ts:109-111` | Permit `type === "shelf"` |
| 4 | `verifyBookAccess` gates create on a single book | `route.ts:66-67` | Shelf-scope check: derive user's bookIds from `UserBookAccess`, pass to engine (no single-book guard) |
| 5 | `type` literal in service/UI types | `discussions.ts:71,360`; `discussions-panel.tsx:82` | Add `"shelf"` |
| 6 | Context assembly hardcoded to `loadBookText`/`extractSectionText` | `discussions.ts:359,985,1209` | `shelf` branch in all 3 callers returns `BuiltPrompt` from the `ContextSourceStrategy` |
| 7 | Library Discussions UI cannot create | `discussions-home.tsx` (no POST) | Wire bar input (`home-view.tsx:194`) → POST shelf discussion → `setTabValue("explainers")` (`home-view.tsx:128`) |

### UI

- **Shelf bar** (`home-view.tsx:194-200`): add `onKeyDown` Enter → POST a shelf discussion (`type:"shelf"`, no `bookId`, first message = the typed text) → `setTabValue("explainers")` on success. **Placeholder changes from "Search or ask your books…" to "Ask your books…"** (the field no longer over-promises search).
- **`DiscussionsHomeView`** (`src/components/library/discussions-home.tsx`): gains POST-create capability for the shelf type. Shelf rows render with a distinct icon + the question snippet (no cover — there's no single book). Existing read/follow-up flows are reused unchanged.
- **Streaming**: first turn and follow-ups reuse the existing `streamChat` plumbing; the only difference is the context source. Citations render via the existing `FOLLOWUP_CITATION_SUFFIX` mechanism, extended to surface source book titles (concept files carry `sourceBookId`).

### Admin — config + build trigger

- **LLM config** (`config.ts`): `getShelfLlmConfig()` returns `{ apiKey, model, maxContextTokens }`:
  - `apiKey` ← `getOpenRouterConfig("admin")` (`openrouter.ts:55`) → `process.env.OPENROUTER_API_KEY` fallback (the existing `getOpenRouterConfig` chain).
  - `model` ← `AppSetting.shelfKnowledgeModel` if set, else the admin-tier configured model.
  - This is "use the Admin key by default," with one tunable knob and no schema change (the `AppSetting` KV table exists for this — `schema.prisma:371`, "Add new keys by calling setSetting(...)").
- **Admin panel** (`src/app/admin/config/page.tsx`): a new "Shelf Knowledge" section exposes the model-override field (`getSetting`/`setSetting`, `services/settings.ts:7,12`) and the "Build shelf wiki" trigger + status. Mirrors the existing category pattern (`/api/admin/config` handles `openrouter|elevenlabs|fal`).
- **Build trigger + status**: admin action invokes `build-wiki.ts`; progress/state persisted to `AppSetting.shelfWikiStatus`. The feature answers nothing until an initial build completes (see Edge cases). New-book upload hooks an incremental re-build into the post-extract step.

### Access control

Shelf discussions respect `UserBookAccess`: `OkfContextSource.buildContext` (and Stage 2's `RagContextSource`) receive the user's accessible bookIds (derived once per request via the same query used by `validateNewAttachments`, `discussions.ts:773-777`) and restrict retrieval to concepts/chunks whose source book is in that set. Standard ownership checks (`discussion.userId === userId`) apply to read/follow-up/delete unchanged.

## Cost & caching

- **Compile (one-time):** ~3.57M tokens of book text read for extraction across 28 books, plus merge/cluster/synthesize passes. Ballpark ~$1 (cheap model) to ~$20 (Sonnet-class) at admin-tier pricing. `build-wiki.ts` prints an exact token/$ preview across 2–3 model tiers and waits for the admin's go before spending.
- **Caching:** every LLM JSON output is keyed by content hash under `shelf-knowledge/.cache/` → re-runs (after tweaking the query step, or adding a book) are incremental/free.
- **Query (per turn):** a navigate call (indexes only, cheap) + an answer call. Slightly more than a single-book discussion turn (see Risks).

## Edge cases

- **User with 0 accessible books:** the ask returns a friendly "add books first" state; no crash, no empty-context LLM call.
- **Wiki not yet built (first run):** first ask shows a "building…" state / prompts the admin to run the initial build. The bar is not disabled, but answers are gated on build completion.
- **Multilingual books (FR/ES):** concepts extracted in/source-language; cross-book themes link by meaning across languages; answers may cite a French book for an English question.
- **A book in the wiki the user can't access:** silently excluded from that user's retrieval (access-filter); never cited.
- **New book uploaded mid-session:** incremental re-build runs in the background; the new book's concepts appear in subsequent turns once its extraction completes.

## Testing

Following the project's Vitest convention:
- **Pure-function unit tests** (no fixtures, no LLM mocks): `render.ts` (JSON→markdown, dangling-link impossibility), `cluster.ts` (grouping), `config.ts` (override/fallback resolution), the content-hash cache key, and the access-filter set intersection.
- **Smoke check (manual/eyeball):** a one-book end-to-end compile + query run against a real OpenRouter config, confirming the JSON→markdown pipeline produces coherent, linked output.
- **Schema migration:** verify existing discussions still load after `bookId` → nullable (the migration is additive; existing rows keep their bookId).

## Risks

- **Progressive-disclosure latency:** a shelf turn = navigate call + answer call, vs one call for a single-book discussion. Acceptable for Stage 1; Stage 2 can cache index navigation or fold navigate+answer into one call when indexes are small.
- **Concept-extraction quality on narrative books** (the video's "catch two"): mitigated by JSON→render (no LLM-written markdown) and the success gate below. If fiction concepts are weak, the `isNarrative` branch template is the tuning knob.
- **Schema migration on the most-depended model:** restart the dev server rigorously per `AGENTS.md` (stale PrismaClient → silent 500s).
- **Token cost surprise on first compile:** the dry-run preview exists to prevent this; the admin confirms before spending.

## Stage-1 success gate

1. Whole-shelf (28-book) wiki compiles end-to-end within the previewed budget; caching works (re-run is incremental/free); the 6 missing-metadata books get a `form`/`topic` backfill.
2. `wiki/` is coherent at scale: hierarchical index accurate, **zero dangling links** (by construction), cross-book theme files meaningfully connect related books, cross-language links work.
3. Shelf discussions answer cross-book synthesis questions by navigating to the right concept files, citing source books, respecting per-user access, without loading the whole library or hallucinating beyond the files.
4. Adding a book incrementally updates the wiki cheaply (only that book + its cluster re-synthesized).
5. `DiscussionsHomeView` creates + streams shelf discussions end-to-end from the shelf bar; the bar placeholder reads "Ask your books…".

Clear all five → Stage 2 (RAG backend + admin toggle + blind evaluation) is worth building.

## Stage 2 (out of scope here)

- `RagContextSource implements ContextSourceStrategy`: chunk + embed all books (Qwen3-Embedding-8B via HuggingFace Inference, OpenAI-compatible `/v1/embeddings`, query-side `Instruct:` prefix), cosine-rank, top-k stuff-and-answer.
- Admin-configurable embedding endpoint (`EmbeddingProviderConfig` mirroring `TtsProviderConfig`, or `AppSetting` keys for `embeddingBaseUrl`/`embeddingApiKey`/`embeddingModel`) — OpenRouter has no embedding models (verified against its `/api/v1/models` catalog).
- Admin OKF/RAG toggle in the `ContextSourceStrategy` factory.
- Blind evaluation harness: fixed question set in three buckets (factual / single-book synth / cross-book synth), both backends answer, A/B randomized, per-bucket tally. Decision rule: OKF is *viable* iff it clearly wins the cross-book-synthesis bucket.
