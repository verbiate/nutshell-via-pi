# Phase 1 Plan 03 Summary: EPUB Processing, Upload Flow & Library Views

**Plan:** 01-03
**Phase:** Phase 1: Foundation
**Completed:** 2026-05-07

## Overview
Implements the complete EPUB processing pipeline (streaming MD5 hash, EPUB parsing via JSZip, TXT conversion, cover extraction, language detection), the upload API route with deduplication logic, the upload dropzone UI with 4-step processing feedback, the Personal Library grid view with empty state, and the book detail page.

## Duration
- **Tasks:** 7/7 completed
- **Commits:** 8
- **Started:** 2026-05-07T22:38:00Z
- **Completed:** 2026-05-07T22:47:00Z (~9 minutes)

## Task Commits

| Task | Description | Commit |
|------|-------------|--------|
| 01 | EPUB processor with streaming MD5, JSZip parsing, TXT conversion, cover extraction | `73fb5ee` |
| 02 | Language detection via franc (ISO 639-3→639-1 mapping) + 7 tests | `4136a09` |
| 03 | Library service (getPersonalLibrary, getUniversalLibrary, getBookForUser) + upload/list API routes | `ce030a1` |
| 04 | Upload dropzone with drag-and-drop + 4-step ProcessingIndicator | `20df5e2` |
| 05 | BookCard (3:4 cover, title-hash placeholder), Bookshelf (auto-fill grid), EmptyLibrary, My Library page | `eb2167a` |
| 06 | Book detail page with two-column layout, TOC list, disabled "Open Reader" button | `c463682` |
| 07 | EPUB validation + MD5 hash unit tests, upload integration mock tests | `9f2374c` |
| 07 (fix) | Fix TypeScript typing in upload mock test | `da6efdb` |

## Key Files Created/Modified

### Core Services
- `src/server/services/epub-processor.ts` — EPUB processor: `streamHash()`, `validateEpub()`, `parseEpub()`, `processAndUploadBook()`
- `src/server/services/library.ts` — Library service: `getPersonalLibrary()`, `getUniversalLibrary()`, `getBookForUser()`, `getBookById()`
- `src/lib/language.ts` — `detectLanguage()` using franc with ISO 639-3→639-1 mapping

### API Routes
- `src/app/api/books/route.ts` — GET /api/books (returns personal library)
- `src/app/api/books/upload/route.ts` — POST /api/books/upload (requires auth, deduplicates by MD5)

### UI Components
- `src/components/library/processing-indicator.tsx` — 4-step indicator (Computing hash, Checking library, Converting, Done)
- `src/components/library/upload-dropzone.tsx` — Client upload with drag-and-drop, client-side validation (non-EPUB reject, 50MB limit)
- `src/components/library/book-card.tsx` — 3:4 aspect ratio card, title-hash colored placeholder with BookOpen icon
- `src/components/library/bookshelf.tsx` — `Bookshelf` (auto-fill minmax 200px grid) + `BookshelfSkeleton` (8 pulse skeletons)
- `src/components/library/empty-library.tsx` — Empty state with "Your library is empty" heading + inline UploadDropzone

### Pages
- `src/app/(library)/my-library/page.tsx` — Server-side My Library with `requireAuth()` + `getPersonalLibrary()`
- `src/app/(library)/book/[id]/page.tsx` — Book detail with cover, metadata, language badge, TOC, disabled Open Reader

### Tests
- `src/server/__tests__/epub.test.ts` — validateEpub (4 cases) + streamHash (2 cases)
- `src/server/__tests__/upload.test.ts` — MD5 deduplication mock test + new book create path test
- `src/server/__tests__/lang.test.ts` — detectLanguage (7 cases for EN/ES/FR/DE/empty/short/mixed)

## Key Implementation Decisions

### EPUB Parsing via JSZip (not @likecoin/epub-ts)
Used JSZip directly instead of `@likecoin/epub-ts` because the library had TypeScript compatibility issues. JSZip provides full ZIP access allowing manual OPF parsing, NCX/nav extraction, and cover image extraction. This approach is more lightweight and avoids library version conflicts.

### Language Detection ISO Mapping
`franc` returns ISO 639-3 codes (e.g., "eng", "spa", "fra") but the schema stores ISO 639-1 (e.g., "en", "es", "fr"). A comprehensive mapping table covers 30+ languages with "und" as fallback for unknown/unstable detections.

### MD5 Deduplication Behavior
When a duplicate EPUB is uploaded: `epubFile.findUnique({ where: { md5 } })` returns existing record → `userBookAccess.upsert()` grants access without creating a new `epubFile`. For new uploads: both `epubFile.create()` AND `userBookAccess.create()` are called.

### TXT Conversion Approach
HTML-to-plaintext conversion strips `<style>`, `<script>`, all tags, and decodes common HTML entities (`&nbsp;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`, numeric entities). Single-file output; chunking deferred to Phase 2 reader work.

### Cover Extraction Priority
1. `properties="cover-image"` item in OPF manifest (EPUB 3 spec)
2. `<meta name="cover" content="ID">` referencing manifest item ID
3. No cover → null (placeholder rendered)

## Requirements Addressed

| Requirement | Status |
|-------------|--------|
| LIB-01: EPUB upload with MD5 deduplication | ✅ Implemented |
| LIB-02: MD5 hash deduplication (same EPUB = 1 epubFile, 2 userBookAccess) | ✅ Implemented |
| LIB-03: EPUB → TXT conversion | ✅ JSZip parsing + HTML stripping |
| LIB-04: EPUB parsing (title, author, TOC, cover) | ✅ Implemented |
| LIB-05: Personal Library showing user-accessible books | ✅ getPersonalLibrary + My Library page |
| LIB-06: Book Detail page with ToC | ✅ Two-column layout with TOC list |
| LANG-03: Language detection via franc | ✅ Implemented with ISO 639-1 output |

## must_haves Status

- [x] Streaming MD5 hash computation using `crypto.createHash("md5")` with ReadableStream
- [x] EPUB validation rejects non-.epub files and files > 50MB
- [x] EPUB parsing extracts title, author, TOC, text content, and cover image
- [x] TXT conversion strips HTML tags and decodes entities
- [x] Language detection via `franc` on first 5000 chars, defaults to "und"
- [x] MD5 deduplication: same EPUB uploaded twice = 1 `epubFile` row, 2 `userBookAccess` rows
- [x] Upload dropzone with drag-and-drop, 200px min-height, processing indicator (4 steps)
- [x] Personal Library grid with responsive `minmax(200px, 1fr)` layout
- [x] Book cards show 3:4 cover (or title-hash colored placeholder), title (clamp-2), author (muted)
- [x] Empty state with "Your library is empty" and inline upload CTA
- [x] Book detail page with two-column layout, disabled "Open Reader" button
- [x] All user-facing text uses "Explainer" — zero occurrences of "summary" in new code
- [x] Cover placeholder uses BookOpen icon at 40% white opacity on title-hash colored bg

## Verification

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | ✅ exits 0 |
| `npx vitest run` | ✅ 22 passed, 1 todo (5 test files) |
| All key files exist | ✅ |
| 8 commits created for Plan 01-03 | ✅ |

## Deviations

### Rule 1 (Bug Fix): TypeScript typing in upload mock test
- **Found during:** Task 07 implementation
- **Issue:** `vi.mocked(db).epubFile.findUnique.mockResolvedValue()` had incorrect typing — the Prisma client type didn't expose `mockResolvedValue` from vitest's perspective
- **Fix:** Cast to `any` before calling mock method
- **Files:** `src/server/__tests__/upload.test.ts`
- **Committed in:** `da6efdb`

### Architectural Note: JSZip instead of @likecoin/epub-ts
- The plan referenced `@likecoin/epub-ts@0.6.3` but JSZip was used directly instead. JSZip provides full ZIP access, OPF parsing, NCX extraction, and cover image extraction with fewer TypeScript compatibility issues. The `@likecoin/epub-ts` package remains installed (required by earlier scaffolding) but is not used in the current implementation.

## State Updates Applied
- `completed_plans` incremented from 2 to 3 in `STATE.md`
- `ROADMAP.md` plan progress updated

## Gaps / Follow-up
- Cover image serve route `/api/files/covers/[id].jpg` not yet implemented — book detail and card currently reference this URL but no route handles it (will be needed for Phase 2 or when a file serve API is built)
- EPUB file serve route `/api/files/epubs/[id]` not yet implemented
- No E2E test for full upload flow (requires real Google OAuth credentials)
- Real-world EPUB corpus testing not yet done — parsing may fail on edge-case EPUB structures

---
*Phase: 01-foundation | Plan: 03 | Status: COMPLETE*

## Self-Check: PASSED

**Verification commands run:**
- `npx tsc --noEmit` → exits 0 ✓
- `npx vitest run` → 22 passed, 1 todo (5 test files) ✓
- All key files present ✓
- 8 commits created for Plan 01-03 ✓
- Summary committed via `pi-gsd-tools commit` ✓
