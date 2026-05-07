# Phase 4: Reading Enhancements — Research

**Researched:** 2026-05-07
**Scope:** Bookmarks, highlights, in-book search, passage-level Explainers, Explainer history

---

## Stack Analysis

### Text Selection & CFI Serialization (`@likecoin/epub-ts`)

The `@likecoin/epub-ts@0.6.3` package (already installed) exposes a complete selection and annotation pipeline:

- **`rendition.on("selected", (cfiRange: string, contents: Contents) => void)`** fires whenever the user selects text inside the EPUB iframe. `cfiRange` is a CFI range string (e.g. `epubcfi(/6/4[id]!/4/2,/6/4[id]!/4/6)`). `contents` provides access to the iframe's `window`, `document`, and DOM helpers.
- **`contents.cfiFromRange(range: Range)`** converts a native DOM `Range` object to a CFI string. This is the canonical way to serialize a selection.
- **`contents.range(cfi: string)`** converts a CFI back to a DOM `Range`. Useful for verifying persisted highlights on load.
- **Selection coordinates:** `contents.window.getSelection().getRangeAt(0).getBoundingClientRect()` returns a `DOMRect` relative to the iframe viewport. All modern browsers support `getBoundingClientRect()` on `Range` (Chrome, Firefox, Safari).

### Highlight Persistence

- **`rendition.annotations.highlight(cfiRange, data?, cb?, className?, styles?)`** injects a highlighted span directly into the iframe DOM. The `Annotations` class automatically hooks into view lifecycle (`inject(view)` / `clear(view)`), meaning highlights survive section changes and theme switches without manual re-application.
- **On full reload:** highlights must be re-registered from the database. The pattern is: fetch user's highlights → loop → `rendition.annotations.highlight(h.cfiRange, ...)`.
- **Theme/font survival:** Because annotations are injected as DOM spans inside the iframe, they will be re-rendered when the iframe content changes. The CFI addresses content, not pixels, so reflows due to theme changes do not break highlight positioning.

### Floating Toolbar Positioning

**Algorithm:**
1. In the `"selected"` handler, get `const range = contents.window.getSelection().getRangeAt(0)`.
2. Get `const rect = range.getBoundingClientRect()` (iframe-local coordinates).
3. Locate the iframe element in the parent document: `containerRef.current?.querySelector("iframe")`.
4. Get `const iframeRect = iframe.getBoundingClientRect()`.
5. Compute parent-frame coordinates:
   - `top = iframeRect.top + rect.top`
   - `left = iframeRect.left + rect.left + rect.width / 2`
6. Render the toolbar in an absolutely positioned div (or Portal) at:
   - `position: fixed` (avoids clipping by overflow containers)
   - `top: top - toolbarHeight - 8px` (above selection)
   - `left: left - toolbarWidth / 2` (centered on selection)
7. **Edge-case handling:** If `top < toolbarHeight + 8`, flip to below: `top = iframeRect.top + rect.bottom + 8px`.

**Cross-browser pitfalls:**
- Safari may report `rect.width === 0` for collapsed selections. Guard: if `rect.width < 2 || rect.height < 2`, hide the toolbar.
- `window.getSelection()` can be null in some iframe edge cases. Always check `selection.rangeCount > 0`.
- Touch devices may not fire `"selected"` reliably unless `user-select: text` is enforced inside the iframe. `epub-ts` already handles this via injected CSS.

### Client-Side Search

**Corpus:** TXT files are stored at `EpubFile.txtPath` (produced in Phase 1). The TXT is plain text with paragraph breaks preserved as `\n\n` or `\n`.

**Strategy:** Naive in-memory string scan is sufficient and optimal for v1.
- A 1MB TXT file (~500 pages) loads in ~50ms and searches in <10ms per query using `RegExp` with `gi` flags.
- No pre-built index is necessary. Building an inverted index adds complexity without measurable benefit at this scale.
- **Debounce:** 300ms on the search input.
- **Minimum query:** 3 characters.

**Algorithm:**
1. `fetch(/api/reader/text?bookId=xxx)` — authenticated endpoint returning the TXT as `text/plain`.
2. Split TXT into paragraphs: `txt.split(/\n\n+/)`.
3. For each query, run `new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")`.
4. For each match, capture a 100-character snippet centered on the match, with the matched term wrapped in `<mark>`.
5. **Paragraph index mapping:** Count paragraphs from the start of the file to the match index. The paragraph index is `paragraphs.slice(0, matchParaIndex).length`.
6. **CFI navigation:** Use the existing `paragraphOffsetToCfi()` library (from Phase 2) to convert the paragraph index to a CFI, then call `viewerRef.current.navigateTo(cfi)`.

**Performance guardrails:**
- Cap results at 50 matches to avoid UI lockup on broad queries (e.g., "the").
- Abort in-flight fetch if the user navigates away.

### Passage-Level Explainers

**Schema extension:** The `Explainer` model currently supports `"book" | "section"`. Extend to `"passage"`:
- `contentType` field already accepts any string (Prisma `String`), but the TypeScript types in `src/server/services/explainer.ts` restrict it. Update `ExplainerLookup.contentType` and `GenerateExplainerParams.type` to `"book" | "section" | "passage"`.

**Cache key:** The existing composite key `(contentHash, language, contentType, tier)` works unchanged. For passages, `computeContentHash` receives the selected text string as `sourceText`.

**Prompt builder:** Add `buildPassagePrompt(bookId, passageText, language)`:
- Loads a `"passage"` `PromptTemplate` (seeded in Phase 1 or created on first use).
- Variables: `{title}`, `{author}`, `{passage}`, `{target_language}`.
- Returns `{prompt, sourceText: passageText, promptVersion}`.

**SSE endpoint flow:**
- `POST /api/explainers/generate` already accepts `type`. Extend body validation to allow `"passage"` and require `passageText` when `type === "passage"`.
- For passage-level, **skip the separate GET cache check** (the client currently calls GET first). Passage text can be large for query params. Instead, call `/api/explainers/generate` directly. The `generateExplainer` orchestrator checks cache on the server and returns the full cached content in a single SSE chunk if found — the UI can detect this (single chunk + `cached: true`).
- Alternatively, if the UI needs cache-before-stream, change the cache-check call to POST with `passageText` in body. Research recommends keeping it simple: go straight to SSE.

**Guard:** The existing context-window guard (`maxChars = 3.6M`) is irrelevant for passages (selections are typically <5K chars). No changes needed.

### Explainer History UI

**The missing link:** The `Explainer` table is a **global cache** keyed by content hash. It does NOT store `bookId` or `userId`. Therefore, we cannot query "all explainers generated for a book by this user" from the `Explainer` table alone.

**Required schema addition:** `ExplainerRequest` junction table:
```prisma
model ExplainerRequest {
  id          String   @id @default(cuid())
  userId      String
  bookId      String
  contentType String   // book | section | passage
  sectionHref String?
  passageText String?  // truncated to ~200 chars for history display
  language    String
  tier        String
  explainerId String
  createdAt   DateTime @default(now())

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  book      EpubFile  @relation(fields: [bookId], references: [id], onDelete: Cascade)
  explainer Explainer @relation(fields: [explainerId], references: [id], onDelete: Cascade)

  @@index([userId, bookId])
  @@index([createdAt])
}
```

And add `requests ExplainerRequest[]` to the `Explainer` model.

**UI Pattern:** List/detail pivot inside the existing `ExplainerPanel` using shadcn `Tabs` (already installed):
- `<Tabs defaultValue="current">` with `value={activeTab}` controlled state.
- **Current tab:** Existing streaming explainer view (unchanged).
- **History tab:** Scrollable list of `ExplainerRequest` records for this book. Each entry shows:
  - Type badge (book/section/passage)
  - Target label (book title, section name, or passage snippet)
  - Language flag/code
  - Date (relative, e.g. "2 hours ago")
  - Tier badge (Pro/Regular)
  - Loading pulse for in-flight requests
- **"Go to context" action:**
  - Book-level → navigates to book detail page
  - Section-level → `viewerRef.current.navigateTo(sectionHref)`
  - Passage-level → `viewerRef.current.navigateTo(cfi)` (requires storing the passage CFI in `ExplainerRequest`)

**Important:** To support "Go to context" for passages, add `passageCfi` to `ExplainerRequest`.

**API:** `GET /api/explainers/history?bookId=xxx` returns the user's history for that book, newest first.

### Bookmarks

**Data model (per D-01):**
```prisma
model Bookmark {
  id             String   @id @default(cuid())
  userId         String
  bookId         String
  cfi            String
  paragraphIndex Int
  charOffset     Int      @default(0)
  selectedText   String?  // context for the bookmark list
  note           String?
  createdAt      DateTime @default(now())

  user User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  book EpubFile @relation(fields: [bookId], references: [id], onDelete: Cascade)

  @@unique([userId, bookId, cfi])
  @@index([userId, bookId])
}
```

**CRUD API pattern:** Mirror `src/app/api/reader/position/route.ts`:
- `GET /api/reader/bookmarks?bookId=xxx` → list bookmarks for user/book
- `POST /api/reader/bookmarks` → create bookmark
- `DELETE /api/reader/bookmarks?id=xxx` → remove bookmark

**UX:** A bookmark button in the reader chrome (bookmark icon). When tapped, saves the current CFI + paragraph index + a snippet of surrounding text. A slide-out panel (reusing `Sheet` + `ScrollArea`) lists all bookmarks with "Go to" buttons.

### Highlights

**Data model (per D-01):**
```prisma
model Highlight {
  id              String   @id @default(cuid())
  userId          String
  bookId          String
  cfi             String   // CFI range, e.g. epubcfi(/6/4[id]!/4/2,/6/4[id]!/4/6)
  paragraphIndex  Int
  charOffsetStart Int
  charOffsetEnd   Int
  selectedText    String   // literal text for recovery
  color           String   @default("#fbbf24") // amber-400
  note            String?
  createdAt       DateTime @default(now())

  user User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  book EpubFile @relation(fields: [bookId], references: [id], onDelete: Cascade)

  @@unique([userId, bookId, cfi])
  @@index([userId, bookId])
}
```

**API:**
- `GET /api/reader/highlights?bookId=xxx`
- `POST /api/reader/highlights`
- `DELETE /api/reader/highlights?id=xxx`

**Client-side rendering:**
1. After EPUB loads and `rendition` is ready, fetch highlights.
2. For each highlight: `rendition.annotations.highlight(h.cfi, { id: h.id }, () => {}, "br-highlight", { background: h.color })`.
3. The annotation click callback can open a small popover to delete the highlight or add a note.
4. On theme change, `rendition.annotations` automatically re-injects highlights into newly rendered views.

**Color:** Start with a single default color (`#fbbf24` amber) per D-01 deferred items. The schema reserves `color` for v2 multi-color support.

---

## Architecture Decisions

### AD-1: Hybrid persistence for bookmarks & highlights
Store CFI + paragraph index + literal selected text. CFI is primary for navigation. Paragraph index is a fallback for drift recovery. Literal text is a checksum for integrity verification. This matches D-01 and reuses the Phase 2 position-tracking philosophy.

### AD-2: Floating toolbar above selection
Render the toolbar in a `position: fixed` div in the parent document, positioned using `Range.getBoundingClientRect()` + iframe offset. Flip to below if too close to the top edge. Actions: "Highlight" and "Explain this to me". If coordinates are unreliable (e.g. `rect.width === 0`), fallback to a temporary inline toolbar in the reader chrome header.

### AD-3: Client-side search with paragraph-to-CFI mapping
Fetch TXT once per reader session. Search in memory with regex. Map matches to paragraph indices, then to CFIs via existing `paragraphOffsetToCfi()`. No server-side search index needed for v1.

### AD-4: Passage-level explainers go straight to SSE
Skip the separate GET cache check for passages to avoid sending large text in query strings. The SSE generation endpoint already does a server-side cache check at the top of `generateExplainer()`. On cache hit, it emits a single chunk with `cached: true`. The UI detects this and shows it as cached.

### AD-5: Explainer history via junction table
Add `ExplainerRequest` to track every explainer generation event per user per book. This preserves the global cache nature of `Explainer` while enabling per-user, per-book history queries. History is displayed inside the existing `ExplainerPanel` using shadcn `Tabs`.

### AD-6: Reuse existing API patterns
All new API routes follow the exact pattern from `src/app/api/reader/position/route.ts`: `requireAuth()` → validate params → `verifyBookAccess()` → Prisma CRUD → JSON response.

---

## Validation Architecture

### Unit Tests
- **Position tracking:** `paragraphOffsetToCfi` and `cfiToParagraphOffset` already have test coverage (Phase 2). Extend with passage CFI round-trip tests.
- **Search algorithm:** Test `searchText(corpus, query)` returns correct paragraph indices and snippets. Edge cases: empty query, no matches, regex special chars in query, multi-paragraph matches.
- **Content hash:** Verify `computeContentHash` produces identical hashes for identical passage text + version + type.
- **Prompt builder:** Verify `buildPassagePrompt` substitutes all template variables correctly.

### Integration Tests
- **Bookmark CRUD:** Create → verify in DB → GET list → DELETE → verify gone.
- **Highlight CRUD:** Create with CFI range → verify `rendition.annotations.highlight` renders the span in the iframe (Playwright screenshot comparison).
- **Search end-to-end:** Upload a book → open reader → type query → verify results panel shows snippets → click result → verify reader navigates to correct paragraph.
- **Passage explainer flow:** Select text → click "Explain" → verify SSE stream returns text → verify `ExplainerRequest` row created → reload page → open history → verify entry appears.
- **History API:** Generate book + section + passage explainers → call history API → verify 3 entries with correct types.

### Edge Cases
- **Empty selection:** User clicks without dragging — `"selected"` may fire with an empty CFI. Guard: ignore selections shorter than 3 characters.
- **Cross-section selection:** User selects text that spans two spine items. `epub-ts` may emit a CFI range that crosses sections. Test if `annotations.highlight` handles this. If not, guard: only allow single-section selections.
- **Large passage:** User selects >50K characters. Guard: cap passage explainer to 10K chars (LLM context window safety) and truncate with ellipsis.
- **Search on empty TXT:** Book uploaded before TXT pipeline ran (should not happen in v1, but guard anyway). Return empty results.
- **Duplicate bookmark:** User bookmarks same CFI twice. The `@@unique([userId, bookId, cfi])` constraint prevents duplicates. Return 409 or silently ignore.
- **Concurrent explainer requests:** User double-clicks "Explain". The UI disables the button during generation. Server-side, duplicate requests for the same hash will both hit cache or both generate; the second will likely find the cached result. No race condition in cache write because Prisma `create` with `@@unique` will throw on duplicate; catch and return existing.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CFI drift across EPUB versions | Low | Medium | Hybrid storage (CFI + paragraph + text) allows fallback recovery. |
| `getBoundingClientRect()` returns 0 on mobile Safari | Medium | Medium | Fallback to chrome toolbar. Touch-selection UX is inherently harder; accept v1 limitation. |
| Cross-section highlight fails | Medium | Low | Guard to single-section selections. Most user selections are intra-paragraph. |
| TXT fetch for large books (>5MB) causes memory pressure | Low | Medium | Stream fetch with `ReadableStream` and process chunks, or cap search to first 2MB. |
| `ExplainerRequest` table grows unbounded | Medium | Low | Add periodic cleanup (v2) or limit history to last 100 entries per user per book. |
| Prompt template for `"passage"` type missing | Low | High | Auto-seed a default passage prompt in the migration if none exists. |
| iframe re-render clears selection before toolbar renders | Medium | Medium | Capture selection data immediately in the `"selected"` handler. Do not rely on DOM selection surviving async operations. |

---

## Integration Points

### Files to Modify

| File | Change |
|------|--------|
| `src/server/db/schema.prisma` | Add `Bookmark`, `Highlight`, `ExplainerRequest` models. Add `requests` relation to `Explainer`. |
| `src/server/services/explainer.ts` | Extend `ExplainerLookup.contentType` and `GenerateExplainerParams.type` to `"passage"`. Add `buildPassagePrompt`. Update `generateExplainer` to handle `type === "passage"`. |
| `src/server/services/prompt-builder.ts` | Add `buildPassagePrompt` function. |
| `src/app/api/explainers/route.ts` | Update `type` validation to accept `"passage"`. Handle `passageText` param for cache checks (or document that passage checks go straight to generate). |
| `src/app/api/explainers/generate/route.ts` | Accept `type: "passage"` and `passageText` in body. Pass to `generateExplainer`. After successful generation, create `ExplainerRequest` record. |
| `src/app/api/explainers/history/route.ts` | **New.** `GET` returns `ExplainerRequest[]` for user + book, joined with `Explainer` content. |
| `src/app/api/reader/bookmarks/route.ts` | **New.** `GET/POST/DELETE` bookmark CRUD. |
| `src/app/api/reader/highlights/route.ts` | **New.** `GET/POST/DELETE` highlight CRUD. |
| `src/app/api/reader/text/route.ts` | **New.** `GET` serves TXT content for authenticated, authorized users. |
| `src/components/reader/epub-viewer.tsx` | Wire `rendition.on("selected", ...)`. Expose `addHighlight(cfiRange, color)` and `clearSelection()` via ref. |
| `src/components/reader/reader-client.tsx` | Manage floating toolbar state, highlight state, search state, bookmark state. Wire debounced saves. |
| `src/components/reader/reader-chrome.tsx` | Add slots for bookmark trigger and search trigger. |
| `src/components/reader/floating-toolbar.tsx` | **New.** Fixed-position toolbar above text selection with Highlight and Explain actions. |
| `src/components/reader/search-panel.tsx` | **New.** Right-side Sheet with search input, debounced query, result list with snippets, paragraph→CFI navigation. |
| `src/components/reader/bookmark-panel.tsx` | **New.** Left or right Sheet listing bookmarks with "Go to" buttons. |
| `src/components/explainer/explainer-panel.tsx` | Add `Tabs` (Current / History). History tab queries `/api/explainers/history`. Passage-level support (skip cache check). |
| `src/lib/reader/position-tracking.ts` | (No changes needed — existing `paragraphOffsetToCfi` used for search result navigation.) |

### Data Flow Diagrams

**Bookmark Creation:**
```
User taps bookmark button
→ ReaderClient captures current CFI + paragraphIndex from EpubViewer ref
→ POST /api/reader/bookmarks { bookId, cfi, paragraphIndex, selectedText }
→ Server: verifyBookAccess → Prisma create → 200
→ UI: toast "Bookmark saved", update local list
```

**Highlight Creation:**
```
User selects text → "selected" event fires
→ FloatingToolbar appears at Range rect coordinates
→ User clicks "Highlight"
→ Client: POST /api/reader/highlights { cfiRange, paragraphIndex, selectedText }
→ Server: verifyBookAccess → Prisma create → 200
→ Client: rendition.annotations.highlight(cfiRange, ..., "br-highlight", { background: "#fbbf24" })
→ UI: toolbar hides, selection clears
```

**Search:**
```
User opens SearchPanel → fetch /api/reader/text?bookId=xxx
→ Client caches TXT string, splits into paragraphs
→ User types query (debounced 300ms)
→ RegExp search over paragraphs → collect matches with snippet + paragraphIndex
→ Display results in ScrollArea
→ User clicks result → paragraphOffsetToCfi(paragraphIndex) → viewerRef.navigateTo(cfi)
```

**Passage Explainer:**
```
User selects text → clicks "Explain this to me" in FloatingToolbar
→ Client: POST /api/explainers/generate { bookId, type: "passage", passageText, language }
→ Server: verifyBookAccess → buildPassagePrompt → computeContentHash → check cache
  → Cache hit: yield cached.content once
  → Cache miss: stream from OpenRouter → createExplainer → create ExplainerRequest
→ Client: SSE stream renders in ExplainerPanel (Current tab)
→ After completion, history list refreshes
```

---

## File Inventory

### New Files (14)

| Path | Purpose |
|------|---------|
| `src/app/api/reader/bookmarks/route.ts` | Bookmark CRUD API |
| `src/app/api/reader/highlights/route.ts` | Highlight CRUD API |
| `src/app/api/reader/text/route.ts` | TXT download for search corpus |
| `src/app/api/explainers/history/route.ts` | Explainer history list API |
| `src/server/services/bookmark.ts` | Bookmark Prisma CRUD service |
| `src/server/services/highlight.ts` | Highlight Prisma CRUD service |
| `src/server/services/search.ts` | Client-side search helpers (split, regex, snippet) |
| `src/components/reader/floating-toolbar.tsx` | Selection toolbar |
| `src/components/reader/search-panel.tsx` | Search UI panel |
| `src/components/reader/bookmark-panel.tsx` | Bookmark list panel |
| `src/components/reader/highlight-layer.tsx` | (Optional) Dedicated highlight rendering wrapper |
| `src/hooks/use-highlights.ts` | TanStack Query hook for highlight fetch/mutate |
| `src/hooks/use-bookmarks.ts` | TanStack Query hook for bookmark fetch/mutate |
| `src/hooks/use-search.ts` | Local state hook for search corpus + results |

### Modified Files (10)

| Path | Purpose |
|------|---------|
| `src/server/db/schema.prisma` | Add 3 new models |
| `src/server/services/explainer.ts` | Passage-level generation support |
| `src/server/services/prompt-builder.ts` | `buildPassagePrompt` |
| `src/app/api/explainers/route.ts` | Accept `"passage"` type |
| `src/app/api/explainers/generate/route.ts` | Accept `passageText`, write `ExplainerRequest` |
| `src/components/reader/epub-viewer.tsx` | Selection event wiring, annotation API exposure |
| `src/components/reader/reader-client.tsx` | Orchestrate all new features |
| `src/components/reader/reader-chrome.tsx` | New slots |
| `src/components/explainer/explainer-panel.tsx` | Tabs for Current/History, passage support |
| `prisma/seed.ts` | Seed `"passage"` prompt template if not present |

---

*Research complete. All decisions validated against existing codebase patterns and `@likecoin/epub-ts@0.6.3` API surface.*
