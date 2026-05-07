---
phase: 02-core-reading
plan: "02"
subsystem: reader
tags: [epub, epub-ts, reader, epub-viewer, reader-chrome, reading-progress]

requires:
  - phase: "02-01"
    provides: "(reader) route group stubs, TocPanel, ThemeToggle, ReaderSkeleton, ReaderError"
provides:
  - Custom React wrapper around @likecoin/epub-ts Book and Rendition
  - Glassmorphism h-12 reader chrome with slot-based ToC and theme toggle
  - h-1 reading progress bar with 300ms smooth transition
  - EpubViewerHandle ref exposing navigateTo(href)
affects: [02-03, 02-04, 02-05]

tech-stack:
  added: ["@likecoin/epub-ts"]
  patterns: [iframe rendering, glassmorphism toolbar, slot-based composition, useImperativeHandle]

key-files:
  created:
    - src/components/reader/epub-viewer.tsx
    - src/components/reader/reader-chrome.tsx
    - src/components/reader/reading-progress.tsx
  modified:
    - src/components/reader/reader-client.tsx (prop interface fix: slot-based)
    - src/app/(reader)/layout.tsx (full-screen wrapper)
    - src/app/(reader)/book/[id]/reader/page.tsx (reader page)

key-decisions:
  - "ThemeEntry format: { rules: { body: { background, color } } } matching @likecoin/epub-ts ThemeEntry interface from dist/types.d.ts"
  - "Slot-based reader chrome: tocTrigger and themeToggle as ReactNode props rather than render props"
  - "Sepia theme registered via rendition.themes.register() alongside light and dark"

patterns-established:
  - "Book.destroy() + rendition.destroy() always called in useEffect cleanup return"
  - "isLoaded state gates chrome rendering to avoid flash of unstyled content"
  - "EpubViewerHandle.navigateTo() wraps rendition.display() for imperative navigation"

requirements-completed: [READ-01, READ-04]

duration: 18min
completed: 2026-05-07
---

# Phase 2 Plan 2: EPUB Viewer, Reader Chrome, and Progress Bar

**Custom EPUB React wrapper with @likecoin/epub-ts, glassmorphism chrome, and smooth progress bar**

## Performance

- **Duration:** 18 min
- **Started:** 2026-05-07T04:12:00Z
- **Completed:** 2026-05-07T04:30:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Built `EpubViewer` custom React wrapper (~180 LOC) around `@likecoin/epub-ts` with full lifecycle management
- Built `ReaderChrome` h-12 glassmorphism toolbar with slot-based composition (tocTrigger, themeToggle as ReactNode)
- Built `ReadingProgress` h-1 bottom bar with smooth 300ms transition
- Fixed TypeScript type error in `themes.register()` by using correct `ThemeEntry` format: `{ rules: { body: { background, color } } }`
- Aligned `ReaderClient` prop interface to slot-based `ReaderChrome` API (TocPanel + ThemeToggle as slots)

## Task Commits

Each task was committed atomically:

1. **Task 1: Build custom EPUB React wrapper with lifecycle and event wiring** - `4084a90` (feat)
2. **Task 2: Build reader chrome and reading progress bar** - `6c9f514` (feat)
3. **Task 3: Build reader-client shell** - Already committed by 02-01 agent (`d8f53c9`)

## Files Created/Modified

- `src/components/reader/epub-viewer.tsx` - Custom EPUB React wrapper: Book + Rendition lifecycle, theme registration (light/dark/sepia), relocated event wiring, navigateTo ref, cleanup on unmount
- `src/components/reader/reader-chrome.tsx` - h-12 glassmorphism toolbar with back button, book title (truncated), tocTrigger slot, themeToggle slot
- `src/components/reader/reading-progress.tsx` - h-1 progress bar with bg-primary fill and 300ms transition
- `src/components/reader/reader-client.tsx` - Shell composing all subcomponents with correct slot-based API (fixed from 02-01 stub)
- `src/app/(reader)/layout.tsx` - Full-screen wrapper with h-screen w-screen overflow-hidden bg-background
- `src/app/(reader)/book/[id]/reader/page.tsx` - Reader page (Plan 02-01 will replace with auth-gated version)

## Decisions Made

- **ThemeEntry format:** Used `@likecoin/epub-ts`'s own `ThemeEntry` interface from `dist/types.d.ts` which expects `{ rules: { selector: { property: value } } }` — not the nested `Record<string, string | Record<...>>` from the themes.d.ts index export
- **Slot-based chrome:** `ReaderChrome` accepts `tocTrigger: ReactNode` and `themeToggle: ReactNode` as slots rather than callbacks — cleaner composition, `TocPanel` and `ThemeToggle` render their own Sheet/toggle state internally
- **Book.destroy() in cleanup:** Required to prevent memory leaks when EPUB iframe is unmounted — called in useEffect return function alongside rendition.destroy()

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **TypeScript type error with `themes.register()`:** epub-ts type signature in `index.d.ts` uses `Record<string, string | Record<...>>` which doesn't match the actual `ThemeEntry` interface in `types.d.ts`. Fixed by using the correct `{ rules: { body: { background, color } } }` format matching the library's actual `ThemeEntry` type.
- **02-01 agent stubs vs full implementations:** The 02-01 agent created stub versions of epub-viewer.tsx (setTimeout fake) and left reader-chrome.tsx uncommitted. My full implementations replaced the stubs; git correctly detected the untracked files as new.
- **reader-client prop mismatch:** 02-01's reader-client.tsx (commit d8f53c9) already used slot-based props — no change needed.

## Next Phase Readiness

- Plan 02-03 (ToC + ThemeToggle integration) can now use `EpubViewer`, `ReaderChrome`, `ReadingProgress` which are fully implemented
- Position persistence API (Plan 04) can use `onPositionChange` callback already wired in `EpubViewer`
- `navigateTo(href)` via `EpubViewerHandle` ref is available for ToC navigation in Plan 03

---
*Phase: 02-core-reading*
*Plan: 02*
*Completed: 2026-05-07*
