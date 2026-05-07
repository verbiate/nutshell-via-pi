# Plan 04-01 Summary: Schema & Foundation

**Executed:** 2026-05-07
**Wave:** 1
**Status:** COMPLETE

---

## Tasks Executed

### 04-01-a: Add Bookmark, Highlight, and ExplainerRequest models to schema.prisma
- Added `model Bookmark` with fields: `id`, `userId`, `bookId`, `cfi`, `paragraphIndex`, `charOffset`, `selectedText`, `note`, `createdAt`
- Added `model Highlight` with fields: `id`, `userId`, `bookId`, `cfi`, `paragraphIndex`, `charOffsetStart`, `charOffsetEnd`, `selectedText`, `color` (default `#fbbf24`), `note`, `createdAt`
- Added `model ExplainerRequest` with fields: `id`, `userId`, `bookId`, `explainerId`, `passageCfi`, `passageText`, `sectionHref`, `createdAt`
- Added reverse relations to `User`: `bookmarks Bookmark[]`, `highlights Highlight[]`, `explainerRequests ExplainerRequest[]`
- Added reverse relations to `EpubFile`: `bookmarks Bookmark[]`, `highlights Highlight[]`, `explainerRequests ExplainerRequest[]`
- Added reverse relation to `Explainer`: `requests ExplainerRequest[]`
- Commit: `0c42ab5`

### 04-01-b: Seed passage prompt template
- Added third `PromptTemplate` upsert for `type: "passage"` in `prisma/seed.ts`
- Template uses `{{title}}`, `{{author}}`, `{{target_language}}`, `{{text}}` placeholders
- Uses idempotent `upsert` pattern
- Commit: `d77073e`

### 04-01-c: Extend ExplainerLookup for passage contentType
- Updated `ExplainerLookup.contentType` to `"book" | "section" | "passage"`
- Updated `GenerateExplainerParams.type` to `"book" | "section" | "passage"`
- Added `passageText?: string` to `GenerateExplainerParams`
- Added `type === "passage"` branch in `generateExplainer` with `passageText` guard
- Added `getBuildPassagePrompt()` lazy import helper (function created in 04-02)
- Updated size guard error to handle all three content types
- Commit: `bad23e8` (amended)

### 04-01-d: Run Prisma migration
- Ran `npx prisma migrate dev --schema=src/server/db/schema.prisma` — migration `20260507233940_add_bookmarks_highlights_explainer_requests` applied
- Ran `npx prisma generate` — Prisma client regenerated successfully
- Migration creates `Bookmark`, `Highlight`, and `ExplainerRequest` tables with proper indexes and foreign keys
- Commit: `e21fe55`

---

## Commits (in order)

| Commit | Task | Description |
|--------|------|-------------|
| `0c42ab5` | 04-01-a | feat(schema): add Bookmark, Highlight, and ExplainerRequest models |
| `d77073e` | 04-01-b | feat(seed): add passage prompt template for passage-level Explainers |
| `bad23e8` | 04-01-c | feat(explainer): extend ExplainerLookup and generateExplainer for passage type |
| `e21fe55` | 04-01-d | chore(db): apply add_bookmarks_highlights_explainer_requests migration |

---

## Acceptance Criteria Verification

| Criteria | Status |
|----------|--------|
| `schema.prisma` contains `model Bookmark` | PASS |
| `schema.prisma` contains `model Highlight` | PASS |
| `schema.prisma` contains `model ExplainerRequest` | PASS |
| `User` model has `bookmarks`, `highlights`, `explainerRequests` relations | PASS |
| `EpubFile` model has `bookmarks`, `highlights`, `explainerRequests` relations | PASS |
| `Explainer` model has `requests` relation | PASS |
| `prisma/seed.ts` contains `type: "passage"` | PASS |
| `seed.ts` passage template has all 4 placeholders | PASS |
| `ExplainerLookup.contentType` includes `"passage"` | PASS |
| `GenerateExplainerParams.type` includes `"passage"` | PASS |
| `GenerateExplainerParams` has `passageText?: string` | PASS |
| `generateExplainer` has `type === "passage"` branch | PASS |
| Migration file exists in `src/server/db/migrations/` | PASS |
| `npx prisma generate` exits with code 0 | PASS |

---

## Known Notes

- `buildPassagePrompt` in `src/server/services/prompt-builder.ts` does not exist yet — will be created in plan 04-02. The TypeScript error `Property 'buildPassagePrompt' does not exist` is expected and will be resolved when 04-02 executes.
- The `passage` contentType requires `buildPassagePrompt` in `prompt-builder.ts` and the passage prompt template to be filled at generation time — both addressed in subsequent plans of Phase 4.

---

## Requirements Covered

- **READ-06** (bookmark schema foundation) — `Bookmark` model added
- **READ-07** (highlight schema foundation) — `Highlight` model added
- **EXP-03** (passage explainer type extension) — `ExplainerLookup` and `generateExplainer` extended; `ExplainerRequest` junction table added
