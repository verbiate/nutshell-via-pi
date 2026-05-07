# Phase 4: Reading Enhancements - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can bookmark positions, highlight text selections, search within the current book, request Explainers for selected passages, and view a history of all Explainers generated for a book. All features operate within the existing reader experience (iframe-based EPUB rendering via @likecoin/epub-ts) and reuse established patterns (slide-out Sheet panels, CFI-based navigation, composite cache keys).

**Requirements:** READ-06 (bookmarks), READ-07 (highlights), READ-08 (search), EXP-03 (passage-level Explainers), EXP-08 (Explainer history list).

</domain>

<decisions>
## Implementation Decisions

### Bookmarks & highlights data model
- **D-01:** Hybrid storage — store CFI + paragraph index + literal selected text string for every bookmark and highlight
  - CFI provides precise EPUB-native addressing
  - Paragraph index provides fallback alignment with existing position tracking
  - Literal selected text acts as a checksum/recovery mechanism if CFI drifts across EPUB versions
  - Schema: `Bookmark` and `Highlight` tables with `userId`, `bookId`, `cfi`, `paragraphIndex`, `charOffsetStart`, `charOffsetEnd`, `selectedText`, `color?`, `note?`, `createdAt`

### Text selection UX
- **D-02:** Floating toolbar appears on text selection inside the EPUB iframe
  - Triggered via `rendition.on("selected", ...)` from @likecoin/epub-ts
  - Toolbar renders in parent frame, positioned near selection coordinates
  - Actions: "Highlight" and "Explain this to me" (passage-level Explainer)
  - If iframe positioning proves unreliable, fallback to a temporary toolbar in the reader chrome header

### Search implementation
- **D-03:** Client-side search — fetch TXT conversion once on reader load, search in memory
  - TXT is already stored per-book from Phase 1 upload pipeline
  - Download via `fetch()` on reader mount, cache in component state
  - Simple string/regex search with paragraph-aware results
  - Debounce query input (300ms), minimum query length: 3 characters
  - Results mapped back to CFI via existing `paragraphOffsetToCfi` library (from Phase 2)
  - Results UI: slide-out panel (consistent with ToC/Explainer panels), showing ~100-char snippets with matched term highlighted
  - Clicking a result jumps to the corresponding paragraph via CFI navigation
  - Rationale: Instant results without server round-trips; large books handled by streaming TXT fetch

### Explainer history (EXP-08)
- **D-04:** Integrated into existing Explainer panel as a list/detail pivot
  - The right-side Explainer panel has two views: "Current" (the active streaming explainer) and "History" (all explainers for this book)
  - History view shows a scrollable list of all generated explainers with: type (book/section/passage), target label (book title, section name, or passage snippet), language, date, tier indicator
  - Each history entry has a one-click "Go to context" link that navigates to the relevant location (book detail, section via CFI, or passage via CFI)
  - Currently-generating explainers appear in the history list with a loading indicator and pulse animation
  - The panel remembers the last view (Current vs History) per session

### Passage-level Explainers (EXP-03)
- **D-05:** Passage-level Explainers use the same `Explainer` model and cache key as book/section levels
  - `contentType` enum extended with `"passage"` value
  - Content hash computed from the selected text string (SHA-256)
  - Same SSE streaming flow via existing `/api/explainers/generate` endpoint
  - Same word-by-word fade-in animation as book/section explainers
  - Triggered from the floating toolbar on text selection ("Explain this to me")

### the agent's Discretion
- Exact floating toolbar positioning algorithm (coordinates from iframe selection events)
- Highlight color palette and persistence (default yellow vs. multi-color)
- Whether bookmarks and highlights share a single slide-out panel or separate ones
- Client-side search indexing strategy (naive string scan vs. pre-built index vs. regex)
- TXT fetch strategy (fetch entire file vs. range requests vs. chunked streaming)
- History list sorting default (newest first vs. type-grouped vs. location-order)
- History list empty state design
- Whether passage-level explainers show a truncated preview of the selected text in the history entry
- Exact UI transition between Current and History views in the Explainer panel
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Requirements
- `.planning/PROJECT.md` - Vision, core value, constraints
- `.planning/REQUIREMENTS.md` - READ-06..08, EXP-03, EXP-08
- `.planning/ROADMAP.md` - Phase 4 goal, success criteria, research flags

### Prior Phase Context
- `.planning/phases/03-ai-explainers/03-CONTEXT.md` - Explainer decisions: caching, SSE streaming, word-by-word animation, panel design
- `.planning/phases/02-core-reading/02-CONTEXT.md` - Reader decisions: CFI-based positioning, slide-out panels, theme system
- `.planning/phases/02-core-reading/02-UI-SPEC.md` - Design system (slate preset, spacing, colors, typography)
- `.planning/phases/01-foundation/01-CONTEXT.md` - Auth patterns, admin panel

### Code References
- `src/components/reader/epub-viewer.tsx` - EPUB iframe renderer; `rendition.on("selected", ...)` integration point
- `src/components/reader/reader-client.tsx` - Reader orchestration; position save/load patterns
- `src/components/reader/reader-chrome.tsx` - Slot-based chrome toolbar; potential toolbar fallback location
- `src/components/reader/toc-panel.tsx` - Sheet panel pattern for search results
- `src/components/reader/reading-progress.tsx` - Progress indicator pattern
- `src/components/reader/reader-skeleton.tsx` - Loading state pattern
- `src/components/reader/reader-error.tsx` - Error state pattern
- `src/components/reader/theme-toggle.tsx` - Mount-gated interaction pattern
- `src/components/reader/ExplainerPanel.tsx` (or similar) - Existing explainer panel to extend with history
- `src/server/reader/position.ts` (or lib) - CFI↔paragraph mapping library (`buildParagraphMap`, `cfiToParagraphOffset`, `paragraphOffsetToCfi`)
- `src/app/api/reader/position/route.ts` - Authenticated API route pattern
- `src/app/api/explainers/route.ts` - Explainer API pattern (cache check, generation)
- `src/server/db/schema.prisma` - Current schema (needs Bookmark, Highlight tables; Explainer model may need `contentType` extension)
- `src/server/services/reader.ts` - Reader service patterns (auth-gated CRUD)
- `src/server/services/library.ts` - Book access verification
- `src/server/services/explainer.ts` - Explainer service (computeContentHash, getExplainer, createExplainer)
- `src/types/book.ts` - Book, BookWithAccess types
- `prisma/seed.ts` - Existing seed data
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/sheet.tsx` - shadcn Sheet, used for ToC and Explainer panels; can be reused for search results
- `src/components/ui/scroll-area.tsx` - shadcn ScrollArea, for long lists (search results, history)
- `src/components/ui/button.tsx` - Button with variants
- `src/components/ui/badge.tsx` - Status badges (cached, generating, passage-level indicator)
- `src/components/ui/skeleton.tsx` - Loading skeletons
- `src/components/ui/tabs.tsx` - Tabs component (Current/History pivot in Explainer panel)
- `cn()` utility from `@/lib/utils` - Tailwind class merging
- `@likecoin/epub-ts` `rendition.on("selected", cb)` - Text selection detection inside iframe
- Existing `paragraphOffsetToCfi` / `cfiToParagraphOffset` mapping functions

### Established Patterns
- Auth-gated API routes: validate access before returning data
- Prisma upsert for user-specific data (position persistence)
- TanStack Query (`useQuery`, `useMutation`) for client-side data fetching
- `sonner` for toast notifications
- Slot-based composition in ReaderChrome
- Debounced saves (3s timeout pattern)
- Server actions vs API routes: API routes used consistently
- Explainer SSE streaming with `ReadableStream` and manual frame parsing
- Word-by-word CSS fade-in animation for explainer text

### Integration Points
- EPUB viewer iframe: `rendition.on("selected")` for selection detection; cross-frame positioning for floating toolbar
- Reader chrome toolbar: can accept new slots (search trigger, bookmark list trigger)
- Existing Explainer panel: extend with tabbed Current/History views
- Book detail page (`/book/[id]`): can show bookmark/highlight counts or Explainer history preview
- TXT file storage: `txtPath` on `EpubFile` model is the search corpus
- Position API (`/api/reader/position`): pattern for bookmark/highlight CRUD APIs
- Explainer API (`/api/explainers`): pattern for passage-level explainer generation
</code_context>

<specifics>
## Specific Ideas

- User explicitly prefers client-side search (Option B) over server-side for in-book search, accepting the memory tradeoff for speed. Server-side search reserved for future library-level search.
- Explainer history as a list/detail pivot inside the existing panel is preferred over a separate panel — keeps the explainer context unified.
- History entries must include a one-click "Go to context" link that navigates back to the relevant book location.
- User is pragmatic about UX details: "we can always change this later" on toolbar positioning.
</specifics>

<deferred>
## Deferred Ideas

- Library-level search (search across all books) — future phase, likely Phase 6 or v2
- Multi-color highlight system — v2 consideration; start with single default color
- Bookmark/highlight sharing between users — explicitly out of scope for v1
- Offline bookmark/highlight persistence — requires service worker; v2

### Reviewed Todos (not folded)
- None reviewed in this phase discussion.

</deferred>

---

*Phase: 04-reading-enhancements*
*Context gathered: 2026-05-07*
