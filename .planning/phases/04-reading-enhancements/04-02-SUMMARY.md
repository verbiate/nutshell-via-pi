# Plan 04-02 Summary: Backend APIs & Services

**Executed:** 2026-05-07
**Commits:** 10 total (including fix commit)

---

## Tasks Executed

### 04-02-a — Extend reader service with bookmark and highlight CRUD
- Added `getBookmarks`, `createBookmark`, `deleteBookmark` to `src/server/services/reader.ts`
- Added `getHighlights`, `createHighlight`, `deleteHighlight` to `src/server/services/reader.ts`
- Commit: `c6d8a26`

### 04-02-b — Add buildPassagePrompt to prompt-builder.ts
- Added `buildPassagePrompt(bookId, passageText, language)` to `src/server/services/prompt-builder.ts`
- Looks up `passage` prompt template from DB, fills with book metadata and passage text
- Commit: `c6d8a26` (included in same commit as 04-02-a)

### 04-02-c — Wire passage type into generateExplainer
- Already implemented in the existing `explainer.ts` (was pre-wired)
- `generateExplainer` already accepts `passageText?: string` param
- Already has `buildPassagePrompt` lazy import and passage branch
- Already uses `type` in `computeContentHash` and `maxTokens` logic
- Commit: `d77073e` (from previous plan 04-01)

### 04-02-d/e — Bookmark CRUD API routes
- `src/app/api/reader/bookmarks/route.ts`: GET/POST with auth, `verifyBookAccess`
- `src/app/api/reader/bookmarks/[id]/route.ts`: DELETE with ownership check
- Commit: `9608e82`

### 04-02-f/g — Highlight CRUD API routes
- `src/app/api/reader/highlights/route.ts`: GET/POST with auth, `verifyBookAccess`
- `src/app/api/reader/highlights/[id]/route.ts`: DELETE with ownership check
- Commit: `9d09285`

### 04-02-h — GET /api/reader/txt route
- Returns TXT content for authenticated users with book access
- Uses `storage.read(book.txtPath)` to fetch and return full text
- Commit: `ba890bd`

### 04-02-i — Update GET /api/explainers for passage type + POST handler
- GET now accepts `type='passage'` with `passageText` query param
- Added POST handler for passage cache checks (avoids URL length limits)
- Commit: `0ff385c`

### 04-02-j — Update POST /api/explainers/generate for passage + ExplainerRequest creation
- Body accepts `type='passage'`, `passageText`, `passageCfi`
- `generateExplainer` called with `passageText`
- After generation completes, `db.explainerRequest.create` records history via junction table
- Uses `computeContentHash` with passage source text
- Fix commit: removed stray `n` characters and added `bookId!` non-null assertion
- Commits: `1e6d206`, `9dc4503`

### 04-02-k — GET /api/explainers/history route
- Returns `ExplainerRequest` records scoped by `userId` + `bookId`
- JOINs `Explainer` for content
- Derives `targetLabel` from `contentType` (book title / section label / passage snippet)
- Returns `passageCfi` and `sectionHref` for navigation
- Commit: `c04efa2`

---

## Files Created/Modified

| File | Change |
|------|--------|
| `src/server/services/reader.ts` | Added bookmark/highlight CRUD functions |
| `src/server/services/prompt-builder.ts` | Added `buildPassagePrompt` |
| `src/server/services/explainer.ts` | Already had passage wiring (04-01) |
| `src/app/api/reader/bookmarks/route.ts` | Created — GET/POST |
| `src/app/api/reader/bookmarks/[id]/route.ts` | Created — DELETE |
| `src/app/api/reader/highlights/route.ts` | Created — GET/POST |
| `src/app/api/reader/highlights/[id]/route.ts` | Created — DELETE |
| `src/app/api/reader/txt/route.ts` | Created — GET |
| `src/app/api/explainers/route.ts` | Updated — passage type + POST handler |
| `src/app/api/explainers/generate/route.ts` | Updated — passage params + ExplainerRequest |
| `src/app/api/explainers/history/route.ts` | Created — GET |

---

## Verification

- `npx tsc --noEmit` — **PASS** (0 errors)

---

## Requirements Covered

- **READ-06** (bookmark CRUD API) — via tasks 04-02-a, d, e
- **READ-07** (highlight CRUD API) — via tasks 04-02-a, f, g
- **READ-08** (TXT endpoint for client search) — via task 04-02-h
- **EXP-03** (passage explainer backend support) — via tasks 04-02-b, c, i, j
- **EXP-08** (history list API via ExplainerRequest) — via task 04-02-k
