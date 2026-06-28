# Ask Your Bookshelf — Stage 1, Plan 3: Admin Config + Auto-Update + Section Deep-Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (A) make the engine's 5 prompts admin-editable via the existing `/admin/prompts` system; (B) add a "Build shelf wiki" admin button + endpoint AND auto-rebuild the wiki when a book is uploaded; (C) make shelf-answer citations clickable deep links to the exact cited section (`#ch:<bookId>:<basename>`), reusing the existing cross-book citation renderer.

**Architecture:** Mirror the explainer `PromptTemplate` system for the 5 shelf prompts (load from DB, fold `.version` into cache keys → free invalidation on save). Chain `build()` onto the existing fire-and-forget metadata hook (`triggerMetadataExtraction`) for auto-update — cache makes it ~1 LLM call/upload. For section links, inject cited books' chapter maps into the answer prompt (so the model emits `#ch:` hrefs in the visible reply) and populate `attachedBookHrefs` from the message's cited bookIds at render time (shelf discussions have no attachments).

**Tech Stack:** Next.js App Router, Prisma/SQLite (no schema change — uses existing `PromptTemplate` + `AppSetting`), the `storage` adapter, Vitest.

## Global Constraints

- **No schema changes.** `PromptTemplate` (type/content/version) + `AppSetting` already cover everything.
- **Cache invalidation on prompt save is mandatory.** The extract/query cache keys fold the loaded template's `.version` (not a hardcoded constant) so an admin save invalidates.
- **`// ponytail:` comments** mark deliberate simplifications.
- Run tests: `npm test`. Lint: `npm run lint` (322 baseline — no new errors).
- After any Prisma touch: restart dev server (`kill -9 $(lsof -ti:3000) && npm run dev`) per AGENTS.md.

## Workstream A — Admin prompt configurator (all 5)

### Task A1: Seed the 5 PromptTemplate rows + type allowlists
**Files:** `prisma/seed.ts` (or a dedicated seed script); `src/lib/prompt-tokens.ts` (`PromptTemplateType` + `AVAILABLE_TOKENS`); `src/server/services/admin.ts` (`VALID_PRESET_TYPES`).
- Seed rows: `shelf_extract_narrative`, `shelf_extract_nonfiction`, `shelf_extract_generic`, `shelf_nav`, `shelf_answer` — default `content` = current constants, `version` = 5/5/5/1/1 (preserve cache stability).
- Add the 5 types to `PromptTemplateType` + `VALID_PRESET_TYPES`; add `{{chapter_index}}` appliesTo for `shelf_answer` (used in C).
- Verify: rows exist in dev DB; types accepted by the preset validators.

### Task A2: extract.ts loads the 3 templates + version-keyed cache
**Files:** `src/server/services/shelf-knowledge/extract.ts`; test.
- `choosePrompt` loads `shelf_extract_{narrative|nonfiction|generic}` via `db.promptTemplate.findUnique` (with a hardcoded fallback to the constant if the row is missing — defensive).
- The cache key uses the LOADED template's `.version` instead of `EXTRACT_PROMPT_VERSION`. (One version per call since the branch picks one template — capture it.)
- TDD: template-loaded path + fallback-when-missing; cache key includes template.version.

### Task A3: query.ts loads shelf_nav + shelf_answer + version-keyed cache
**Files:** `src/server/services/shelf-knowledge/query.ts`; test.
- `buildNavPrompt`/`buildAnswerPrompt` load `shelf_nav`/`shelf_answer` from DB (fallback to inline defaults).
- Cache keys fold each template's `.version`.

### Task A4: /admin/prompts — 5 new tabs
**Files:** `src/app/admin/prompts/page.tsx`.
- Add tabs/triggers for the 5 shelf types, reusing `<PromptEditor>` + `<PresetSelect>` + `<TokenReferencePanel>`.
- Group under a "Shelf" heading for clarity (the page is getting tab-heavy).

## Workstream B — Auto-update + admin build button

### Task B1: Build + status endpoints
**Files:** `src/app/api/admin/shelf-wiki/build/route.ts` (POST → kicks `build()`, returns status); `src/app/api/admin/shelf-wiki/status/route.ts` (GET → `AppSetting.shelfWikiStatus`).
- POST is admin-gated (`requireAdmin`); fire-and-forget the build (don't block the response) but report `{state:"building"}` immediately. (The build itself sets `done`/`error` status.)

### Task B2: Admin panel "Build shelf wiki" button + status
**Files:** `src/app/admin/config/page.tsx` (or a new shelf-knowledge section).
- A bespoke Card (per the Plan-1 UI map, `ConfigRow` doesn't fit actions): a "Build shelf wiki" button (hits POST) + a status display (polls GET or invalidates on a query key).
- Show: state (idle/building/done/error), last-built timestamp, concept/theme counts.

### Task B3: Auto-update on upload
**Files:** `src/server/services/epub-processor.ts` (`triggerMetadataExtraction`, ~`:443`).
- Chain: `extractBookMetadata(...).then(() => { void build().catch(recordError); })`. Fire-and-forget; only after metadata lands (so `isNarrative` routes the prompt).
- `// ponytail:` note: cache makes this ~1 new extraction call (the new book) + free re-renders; existing books/themes are cache hits.

## Workstream C — Section-level deep links

### Task C1: answer prompt emits `#ch:` + chapter maps injected
**Files:** `src/server/services/shelf-knowledge/query.ts`; `shelf_answer` default content (seeded in A1).
- In the answer step, for each cited book, load `tocJson` and inject `buildChapterIndex(tocJson, cap, bookId)` into the answer prompt (mirror `buildAttachmentSuffix`).
- Rewrite the `shelf_answer` default to instruct the model to cite IN THE VISIBLE reply via `#ch:<bookId>:<basename>` copied from the injected chapter maps (not a hidden Sources list). Keep the citations array for the renderer's href resolution.
- Cache the answer call keyed on question+access+cited-book-set (chapter maps are deterministic per book).

### Task C2: populate `attachedBookHrefs` for shelf messages at render time
**Files:** `src/components/discussion/discussions-panel.tsx`; `src/components/library/discussions-home.tsx`; maybe a small `useShelfCitedBookHrefs` hook + an API to fetch spine hrefs by bookId.
- The wrinkle: `ExplainerContent` validates `#ch:<bookId>:<basename>` against `attachedBookHrefs[bookId]`; shelf discussions have no attachments → must populate it from the message's cited bookIds.
- A hook: parse `#ch:<bookId>:` hrefs out of the assistant message(s) (regex via `parseBookRef`/`BOOK_PREFIX_RE`), dedupe bookIds, batch-fetch those books' spine hrefs (a small GET endpoint or extend the discussion detail payload), pass as `attachedBookHrefs` to `ExplainerContent` for shelf messages.
- No schema change. Hallucinated hrefs degrade safely to plain text (the existing fallback).

### Task C3: end-to-end verification (real #ch: links render + navigate)
- Rebuild the wiki (so concepts carry cited sections), ask a question, confirm the streamed answer contains `#ch:` links that render clickable and navigate to the cited book's section in the reader.

---

## Self-Review

**Coverage:** A (5 prompts editable + cache invalidation) → A1-A4; B (build button + auto-update) → B1-B3; C (section links: prompt + chapter maps + renderer plumbing) → C1-C3. The deferred Plan-2 items (admin build button/endpoint, incremental rebuild) are exactly B. The dev orphan-row cleanup remains deferred (separate, low-priority).

**Risk:** C2 (attachedBookHrefs plumbing) is the most complex — shelf messages cite arbitrary accessible books, so the renderer must resolve hrefs for whatever the model cited. The parse-from-content approach avoids schema change. If it proves fiddly, fallback is book-level `#book:` (deferred).

**Type consistency:** `shelf_answer` template's `.version` flows from A1 (seed) → A3 (cache key) → C1 (rewrite default content). `ShelfCitation` shape unchanged (carries bookId already).
