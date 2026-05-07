---
phase: 02-core-reading
plan: "01"
subsystem: database, routing, theming
tags: [prisma, sqlite, next-themes, sepia, reader, routing]

requires:
  - phase: "01-foundation"
    provides: User/EpubFile models, requireAuth, getBookForUser
provides:
  - UserBookPosition model for content-based reading position persistence
  - Full-screen (reader) route group with auth-gated reader page
  - next-themes ThemeProvider with light/dark/sepia themes
  - Open Reader navigation from book detail to reader
affects: [02-core-reading]

tech-stack:
  added: [UserBookPosition Prisma model]
  patterns: [Route group for full-screen layout, content-based position tracking]

key-files:
  created:
    - src/app/(reader)/layout.tsx
    - src/app/(reader)/book/[id]/reader/page.tsx
    - src/components/reader/reader-client.tsx
  modified:
    - src/server/db/schema.prisma
    - src/components/providers.tsx
    - src/app/globals.css
    - src/app/(library)/book/[id]/page.tsx

key-decisions:
  - "Sepia theme uses hex values (#f4ecd8 background, #5b4636 foreground) per 02-UI-SPEC.md design contract"
  - "ThemeProvider uses attribute='class' with enableSystem=false per project convention"
  - "Reader route is separate (reader) route group from (library) to achieve full-screen without header chrome"
  - "reader-client.tsx uses existing full implementation from 02-02 agent with bookId/bookTitle/epubUrl props"

patterns-established:
  - "Full-screen route group: layout with h-screen w-screen overflow-hidden, no header chrome"
  - "Server component reader page: async function calling requireAuth() + getBookForUser(), redirect on no access"
  - "ThemeProvider wrapper with explicit themes array and enableSystem=false"

requirements-completed: [READ-01, READ-02]

duration: 4 min
completed: 2026-05-07T04:30:10Z
---

# Phase 2 Plan 1: Reader Infrastructure Summary

**Database migrated with UserBookPosition model, full-screen (reader) route group created, next-themes wired with sepia support, and Open Reader button enabled on book detail page.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-07T04:26:20Z
- **Completed:** 2026-05-07T04:30:10Z
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 4

## Accomplishments

- UserBookPosition Prisma model applied via migration, Prisma client regenerated
- (reader) route group with full-screen layout established at /book/[id]/reader
- next-themes ThemeProvider configured with light/dark/sepia themes
- Open Reader button on book detail page now navigates to reader route

## Task Commits

Each task was committed atomically:

1. **Task 1: Add UserBookPosition model and migrate** - `30822a1` (feat)
2. **Task 2: Create (reader) route group with full-screen layout and reader page** - `5003111` (feat)
3. **Task 3: Wire ThemeProvider with sepia and enable Open Reader navigation** - `72490e3` (feat)

**Plan metadata:** `e4d56b9` (docs: complete plan)

## Files Created/Modified

- `src/server/db/schema.prisma` - Added UserBookPosition model with @@unique([userId, bookId]), added positions relations to User and EpubFile
- `prisma/migrations/20260507042638_add_user_book_position/migration.sql` - Migration applied
- `src/app/(reader)/layout.tsx` - Full-screen layout: h-screen w-screen overflow-hidden bg-background
- `src/app/(reader)/book/[id]/reader/page.tsx` - Auth-gated async server component calling requireAuth() + getBookForUser(), redirects to /my-library if no access
- `src/components/reader/reader-client.tsx` - Uses existing full implementation from 02-02 agent with EpubViewer, ReaderChrome, TocPanel integration
- `src/components/providers.tsx` - Added ThemeProvider with themes=["light","dark","sepia"], enableSystem=false, attribute="class"
- `src/app/globals.css` - Added .sepia CSS variable block with --background:#f4ecd8, --foreground:#5b4636 warm parchment palette
- `src/app/(library)/book/[id]/page.tsx` - Enabled Open Reader button: removed disabled prop + tooltip, replaced with Link-wrapped Button

## Decisions Made

- Sepia theme uses exact hex values from 02-UI-SPEC.md design contract (#f4ecd8 background, #5b4636 foreground, #e9dfc6 secondary, #d4c5a9 border)
- (reader) route group kept separate from (library) to maintain full-screen immersive mode without persistent library header
- reader-client.tsx reuses the full implementation already created by 02-02 agent rather than creating a minimal stub

## Deviations from Plan

None - plan executed exactly as written.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** No deviations. Plan executed exactly as specified.

## Issues Encountered

None.

## Next Phase Readiness

- UserBookPosition model is ready for position persistence API (READ-05) — future plan
- (reader) route group is established for subsequent Phase 2 reader components (02-02, 02-03)
- ThemeProvider with sepia is wired and ready for ThemeToggle component (02-02)
- Prisma schema validated and migration applied cleanly

---
*Phase: 02-core-reading*
*Completed: 2026-05-07*
