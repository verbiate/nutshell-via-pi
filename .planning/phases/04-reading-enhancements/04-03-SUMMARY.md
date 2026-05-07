# Plan 04-03 Summary: Reader UI — Toolbar, Search, Bookmarks

**Plan:** 04-03
**Phase:** 4 — Reading Enhancements
**Executed:** 2026-05-07
**Status:** COMPLETE — all tasks committed

---

## Tasks Executed

| Task | Title | Commit |
|------|-------|--------|
| 04-03-a | Add selection handling to epub-viewer.tsx | `3e29ef5` |
| 04-03-b | Create FloatingToolbar component | `ce9a982` |
| 04-03-c | Create SearchPanel component | `fc3c814` |
| 04-03-d | Create BookmarkPanel component | `93d0477` |
| 04-03-e | Update ReaderChrome with bookmark and search slots | `3d04b6c` |
| 04-03-f | Integrate all new UI into ReaderClient | `e545338` |

---

## Files Created

- `src/components/reader/floating-toolbar.tsx` — Portal-rendered floating toolbar
- `src/components/reader/search-panel.tsx` — Debounced in-book search panel
- `src/components/reader/bookmark-panel.tsx` — Bookmark list/management panel

## Files Modified

- `src/components/reader/epub-viewer.tsx` — Added selection events, highlight API, navigateToParagraph
- `src/components/reader/reader-chrome.tsx` — Added bookmark/search slot props
- `src/components/reader/reader-client.tsx` — Full integration of all new components
- `src/app/globals.css` — Added `.search-match` theme variants

## Requirements Covered

- **READ-06** — Bookmark creation + panel (BookmarkPanel, BookmarkPanel, bookmark save trigger)
- **READ-07** — Highlight creation via floating toolbar (FloatingToolbar → POST /api/reader/highlights)
- **READ-08** — Search panel (SearchPanel with debounced TXT search)
- **EXP-03** — Passage explainer trigger from floating toolbar (handleExplainPassage → ExplainerPanel type="passage")

---

## Key Decisions

- **navigateToParagraph**: Added to EpubViewerHandle because `paragraphOffsetToCfi` requires the Book instance and ParagraphMap (built async from epub spine). The EpubViewer caches the ParagraphMap lazily on first paragraph navigation call.
- **Search result navigation**: Uses `navigateToParagraph` which builds the paragraph map once and caches it in `paragraphMapRef` for subsequent fast lookups.
- **currentCfi tracking**: Added `currentCfi` state tracked via `handlePositionChange` so BookmarkPanel "Bookmark this page" button has the current reader position.
- **ExplainerPanel type="passage"**: The ExplainerPanel already supported `type="passage"` with `passageText` prop — used directly for the passage-level explainer flow.

---

## Acceptance Criteria Status

All acceptance criteria from 04-03-PLAN.md verified:

- [x] `epub-viewer.tsx` contains `onTextSelected?: (cfiRange: string` in EpubViewerProps
- [x] `epub-viewer.tsx` contains `rendition.on("selected"`
- [x] `epub-viewer.tsx` EpubViewerHandle contains `clearSelection`
- [x] `epub-viewer.tsx` EpubViewerHandle contains `addHighlight`
- [x] `grep -n '"selected"' src/components/reader/epub-viewer.tsx` returns a match
- [x] `grep -n "clearSelection" src/components/reader/epub-viewer.tsx` returns at least 2 matches
- [x] `grep -n "addHighlight" src/components/reader/epub-viewer.tsx` returns at least 2 matches
- [x] `floating-toolbar.tsx` exists with `role="toolbar"`, amber Highlighter, violet Sparkles
- [x] `search-panel.tsx` exists with 300ms debounce, min 3 chars, /api/reader/txt fetch
- [x] `globals.css` contains `.search-match` with light/dark/sepia variants
- [x] `bookmark-panel.tsx` exists with left Sheet, DELETE API, "Bookmark this page" button
- [x] `reader-chrome.tsx` contains bookmarkTrigger, searchTrigger, bookmarkSaveTrigger props
- [x] `reader-client.tsx` contains FloatingToolbar, SearchPanel, BookmarkPanel, ExplainerPanel integration
- [x] `reader-client.tsx` contains `onTextSelected={handleTextSelected}` on EpubViewer
- [x] `reader-client.tsx` contains `type="passage"` on ExplainerPanel
- [x] `npx tsc --noEmit` passes with no errors

---

## Git Log

```
3e29ef5 feat(reader): add selection events and highlight API to epub-viewer
ce9a982 feat(reader): add FloatingToolbar component for text selection actions
fc3c814 feat(reader): add SearchPanel with debounced in-book text search
93d0477 feat(reader): add BookmarkPanel for bookmark management
3d04b6c feat(reader): extend ReaderChrome with bookmark and search slots
e545338 feat(reader): integrate all reader UI components into ReaderClient
```
