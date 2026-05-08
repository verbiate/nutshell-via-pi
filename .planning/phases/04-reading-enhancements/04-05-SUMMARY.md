# Plan 04-05 Summary: Tests & Final Integration

**Executed:** 2026-05-07
**Commits:** 5 (atomic per task)
**Test Results:** 78 tests passing across 16 test files

---

## Tasks Executed

### 04-05-a: Reader service tests for bookmarks and highlights
- Created `src/server/services/__tests__/reader.test.ts`
- Tests for `getBookmarks`, `createBookmark`, `deleteBookmark` (READ-06)
- Tests for `getHighlights`, `createHighlight`, `deleteHighlight` (READ-07)
- Tests for `verifyBookAccess` (uploader access, explicit access, no access)
- 11 tests total

### 04-05-b: Bookmark API route tests
- Created `src/app/api/reader/bookmarks/__tests__/route.test.ts` (GET + POST)
- Created `src/app/api/reader/bookmarks/[id]/__tests__/route.test.ts` (DELETE)
- Validates 400 (missing params), 403 (no access), 200 (success)
- 5 tests total

### 04-05-c: Highlight API route tests
- Created `src/app/api/reader/highlights/__tests__/route.test.ts` (GET + POST)
- Created `src/app/api/reader/highlights/[id]/__tests__/route.test.ts` (DELETE)
- Validates 400 (missing params), 403 (no access), 200 (success)
- 5 tests total

### 04-05-d: TXT and history API route tests
- Created `src/app/api/reader/txt/__tests__/route.test.ts`
  - READ-08: 400 (missing bookId), 403 (no access), 404 (no TXT), 200 (success)
- Created `src/app/api/explainers/history/__tests__/route.test.ts`
  - EXP-08: 400 (missing bookId), 403 (no access), 200 with ExplainerRequest scoping
  - Asserts `where: { userId, bookId }` and `include: { explainer: true }`
- 7 tests total

### 04-05-e: Update existing explainer tests for passage support
- Updated `src/server/services/__tests__/explainer.test.ts`
  - Added `describe("EXP-03: Passage explainer")` block
  - `getExplainer` with `contentType: "passage"` and composite unique key
- Updated `src/app/api/explainers/__tests__/route.test.ts`
  - Added passage validation: returns 400 when `type=passage` without `passageText`
- Created `src/app/api/explainers/generate/__tests__/route.test.ts`
  - POST /api/explainers/generate: 400 for passage without passageText, 403 for no access

### 04-05-f: Full test suite verification
- All 78 tests pass across 16 test files
- No TypeScript compilation errors
- No test failures

---

## Requirements Covered

| Requirement | Description | Tests |
|---|---|---|
| READ-06 | Bookmarks CRUD | `reader.test.ts` (service) + `bookmarks/route.test.ts` (API) |
| READ-07 | Highlights CRUD | `reader.test.ts` (service) + `highlights/route.test.ts` (API) |
| READ-08 | TXT search/load | `txt/route.test.ts` |
| EXP-03 | Passage explainer | `explainer.test.ts` (service) + `route.test.ts` (API) |
| EXP-08 | History API | `history/route.test.ts` |

---

## Files Created

- `src/server/services/__tests__/reader.test.ts`
- `src/app/api/reader/bookmarks/__tests__/route.test.ts`
- `src/app/api/reader/bookmarks/[id]/__tests__/route.test.ts`
- `src/app/api/reader/highlights/__tests__/route.test.ts`
- `src/app/api/reader/highlights/[id]/__tests__/route.test.ts`
- `src/app/api/reader/txt/__tests__/route.test.ts`
- `src/app/api/explainers/history/__tests__/route.test.ts`
- `src/app/api/explainers/generate/__tests__/route.test.ts`

## Files Modified

- `src/server/services/__tests__/explainer.test.ts` (added EXP-03 block)
- `src/app/api/explainers/__tests__/route.test.ts` (added passage validation test)

---

## Test Patterns Used

All tests follow the established project patterns:
- `vi.mock("@/server/db", ...)` for database mocks
- `vi.mock("@/lib/auth-guards", ...)` for auth guards with inline `AuthError` class
- `vi.mock("@/server/services/reader", ...)` for reader service mocks
- `vi.mocked(...).mockResolvedValue(...)` / `mockRejectedValue(...)` for async returns
- `vi.clearAllMocks()` in `beforeEach` for isolation
- Route handlers tested via `new Request(...)` + actual handler function call
