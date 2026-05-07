---
phase: 02-core-reading
plan: 03
subsystem: ui
tags: [toc, theme, loading, error, reader]

requires:
  - phase: "02-core-reading"
    provides: ToC navigation, theme cycling, skeleton/error states
provides:
  - ToC panel with hierarchical entries (left Sheet, ScrollArea, recursive TocEntry)
  - ThemeToggle with mount-gating and light→sepia→dark cycle
  - ReaderSkeleton with 5 varying-width skeleton lines
  - ReaderError with exact UI-SPEC copy (AlertCircle, two-button actions)
  - ReaderClient composing all reader sub-components
affects: [02-01, 02-02, phase-2, phase-3]

tech-stack:
  added: []
  patterns: [shadcn Sheet side=left, next-themes mount-gating, recursive TocEntry rendering]

key-files:
  created:
    - src/components/reader/toc-panel.tsx
    - src/components/reader/theme-toggle.tsx
    - src/components/reader/reader-skeleton.tsx
    - src/components/reader/reader-error.tsx
    - src/components/reader/reader-client.tsx
  modified:
    - src/app/(reader)/book/[id]/reader/page.tsx (session.id fix)

key-decisions:
  - "Used NavItem.label (not title) from @likecoin/epub-ts for ToC entry text"
  - "Mount-gated ThemeToggle renders h-7 w-7 placeholder to prevent hydration mismatch"
  - "ReaderClient orchestrates state: isLoaded drives skeleton/error/chrome visibility"
  - "Fixed AuthenticatedUser.id access (was session.user.id, AuthenticatedUser has id directly)"

patterns-established:
  - "Shadcn Sheet with side=left and w-[320px] sm:w-[360px] for ToC panel"
  - "Recursive TocEntry with level-based indent (16px steps) and left border for hierarchy"
  - "next-themes cycleTheme() pattern: light→sepia→dark with useTheme + useEffect mount gate"

requirements-completed: [READ-01, READ-02, READ-03, READ-04]

duration: 4.5min
completed: 2026-05-07T00:50:00Z
---

# Phase 2 Plan 3: ToC Panel, Theme Toggle, and Loading/Error States

**ToC panel with left Sheet, hierarchical navigation, theme toggle with mount-gating, and skeleton/error state overlays**

## Performance

- **Duration:** 4.5 min
- **Started:** 2026-05-07T00:26:32Z
- **Completed:** 2026-05-07T00:50:00Z
- **Tasks:** 3
- **Files created:** 5
- **Files modified:** 1

## Accomplishments

- Built ToC panel using shadcn Sheet side=left with 320/360px width, ScrollArea, and recursive TocEntry rendering
- Built mount-gated ThemeToggle cycling light→sepia→dark with correct lucide icons per theme
- Built ReaderSkeleton (5 varying-width skeleton lines) and ReaderError (exact UI-SPEC copy with AlertCircle)
- Wired all components into ReaderClient with proper isLoaded/error state management
- Fixed AuthenticatedUser.id bug in reader page (was session.user.id)

## Task Commits

Each task was committed atomically:

1. **Task 1: Build ToC panel** - `20d8c6d` (feat)
2. **Task 2: Build theme toggle** - `ce4fe56` (feat)
3. **Task 3: Build skeleton/error/wire reader-client** - `d8f53c9` (feat)
4. **Reader page bug fix** - `a2b7c36` (fix)

## Files Created/Modified

- `src/components/reader/toc-panel.tsx` - Left Sheet with ScrollArea, recursive TocEntry, active state, empty state
- `src/components/reader/theme-toggle.tsx` - Mount-gated theme cycling, Sun/BookOpen/Moon icons
- `src/components/reader/reader-skeleton.tsx` - Loading overlay with 5 skeleton lines (varying widths per UI-SPEC)
- `src/components/reader/reader-error.tsx` - Error Card with AlertCircle, exact copy from UI-SPEC, Back/Retry actions
- `src/components/reader/reader-client.tsx` - Orchestrates all sub-components: EpubViewer, ReaderChrome, TocPanel, ThemeToggle, ReadingProgress, ReaderSkeleton, ReaderError
- `src/app/(reader)/book/[id]/reader/page.tsx` - Fixed `session.user.id` → `session.id`

## Decisions Made

- Used `NavItem.label` (epub-ts native) for ToC entry text, not `title`
- ThemeToggle renders `h-7 w-7` placeholder before mount to match icon-sm button dimensions
- ReaderClient shows skeleton when `!isLoaded && !error`, error overlay when `error`, chrome when `isLoaded`
- `ReaderChrome` is fully rendered but `TocPanel` manages its own Sheet open state (trigger in chrome area)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **TypeScript type errors in epub-viewer from 02-01 agent** - The epub-viewer (02-01) had complex TypeScript errors in `rendition.themes.register()` and `rendition.on('relocated')`. Fixed by using `any` type assertions for library compatibility. The 02-01 agent wrote a full epub-viewer implementation rather than a minimal stub.
- **session.user.id bug** - The reader page.tsx used `session.user.id` but `AuthenticatedUser` has `id` directly (no `.user` wrapper). Fixed with a quick patch commit.

## Next Phase Readiness

- ToC panel, theme toggle, skeleton, and error states are complete. ReaderClient is wired and ready for position persistence (READ-05) and the reader route is functional.
- Phase 2 remaining: READ-05 (position persistence) - likely in plan 02-04.

---
*Phase: 02-core-reading plan 03*
*Completed: 2026-05-07*
