---
phase: 02-core-reading
plan: "04"
subsystem: reader
tags: [epub, position-tracking, cfi, persistence, api]

requires:
  - phase: "02-01"
    provides: "UserBookPosition model, reader route group, ThemeProvider with sepia"
  - phase: "02-02"
    provides: "Custom EPUB wrapper, EpubViewerHandle.navigateTo(), ReaderChrome"
  - phase: "02-03"
    provides: "ToC panel, ThemeToggle, ReaderSkeleton, ReaderError"

provides:
  - Position tracking library with bidirectional CFI ↔ paragraph index mapping
  - Authenticated position CRUD API route (GET/POST)
  - Reader components wired with debounced save (3s) and CFI-based instant restore
  - READ-05: paragraph index + char offset persistence with CFI fallback

affects: [reader, api, library]

tech-stack:
  added: []
  patterns:
    - "Bidirectional CFI/paragraph mapping: CFI used for runtime navigation, paragraph index + charOffset persisted for theme-reflow survival"
    - "Debounced position saves: setTimeout 3000ms, cleared before re-setting, cleared on unmount"
    - "Significant-change filtering: only save on new paragraph or charOffset diff > 50"
    - "CFI-first restore: initialCfi used for instant accurate restore; paragraph index is fallback"

key-files:
  created:
    - "src/lib/reader/position-tracking.ts — CFI↔paragraph mapping library (buildParagraphMap, cfiToParagraphOffset, paragraphOffsetToCfi, getSectionForParagraph)"
    - "src/server/services/reader.ts — getPosition, savePosition, verifyBookAccess"
    - "src/app/api/reader/position/route.ts — Authenticated GET + POST handlers"
  modified:
    - "src/components/reader/epub-viewer.tsx — Added initialCfi prop, getCurrentCfi() imperative handle, lastCfiRef tracking"
    - "src/components/reader/reader-client.tsx — Added position fetch on mount, debounced save, initialCfi pass-through"

key-decisions:
  - "CFI preferred over paragraph mapping for restore: rendition.display(initialCfi) gives instant accurate resume; paragraphOffsetToCfi is fallback"
  - "Debounce at 3 seconds: balances save frequency against risk of losing position if user closes tab"
  - "Significant-change filter: paragraphIndex change OR charOffset diff > 50 prevents save spam from tiny adjustments"
  - "Access validation on both GET and POST: 403 returned if user has no book access"

patterns-established:
  - "DOMParser in buildParagraphMap: browser-only (client component, async), parses section.render() HTML strings"
  - "Non-blocking position fetch: fetch fails silently with warning; reader proceeds without restore"
  - "Timeout cleanup on unmount: useEffect return clears saveTimeoutRef to prevent saves after component destroyed"

requirements-completed: [READ-05]

duration: ~10 min
completed: 2026-05-07
---

# Phase 2 Plan 04 Summary

**Position persistence via bidirectional CFI/paragraph mapping with debounced API saves and CFI-first restore**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-07T04:33:00Z
- **Completed:** 2026-05-07T04:43:11Z
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- Built a bidirectional mapping layer between epub-ts CFIs and paragraph index + char offset
- Implemented authenticated GET/POST API route for position CRUD with access validation
- Integrated debounced position save (3s, significant-change filtered) and CFI-first instant restore into reader components
- READ-05 (reading position persistence) fully implemented

## Task Commits

Each task was committed atomically:

1. **Task 1: Build position tracking library (CFI ↔ paragraph mapping)** - `b812401` (feat)
2. **Task 2: Build server service and API route for position CRUD** - `c65e304` (feat)
3. **Task 3: Integrate position save/restore into reader client and viewer** - `9aadd92` (feat)

## Files Created/Modified

- `src/lib/reader/position-tracking.ts` — CFI↔paragraph bidirectional mapping with buildParagraphMap, cfiToParagraphOffset, paragraphOffsetToCfi, getSectionForParagraph
- `src/server/services/reader.ts` — getPosition, savePosition, verifyBookAccess
- `src/app/api/reader/position/route.ts` — Authenticated GET + POST with access validation
- `src/components/reader/epub-viewer.tsx` — Added initialCfi prop, getCurrentCfi() handle, lastCfiRef
- `src/components/reader/reader-client.tsx` — Position fetch on mount, debounced save (3s), initialCfi pass-through

## Decisions Made

- **CFI preferred for restore**: `rendition.display(initialCfi)` gives instant accurate resume; paragraph mapping is fallback only if CFI unavailable
- **Debounce at 3 seconds**: balances save frequency against risk of losing position if user closes tab quickly
- **Significant-change filter**: only save when paragraph changes or charOffset differs by >50 chars; prevents save spam from intra-paragraph movements
- **Access validation on both GET and POST**: 403 returned if user has no book access (via UserBookAccess or uploadedById)

## Deviations from Plan

**Auto-fixed Issues**

**1. [Rule 2 - Missing Critical] Prisma null vs undefined type mismatch in getPosition**
- **Found during:** Task 2 (API route implementation)
- **Issue:** `db.userBookPosition.findUnique` returns `string | null` for optional fields but our return type said `string | undefined`. TypeScript error TS2322.
- **Fix:** Added explicit null→undefined conversion: `cfi: position.cfi ?? undefined` before returning
- **Files modified:** `src/server/services/reader.ts`
- **Verification:** `npx tsc --noEmit` passes cleanly after fix
- **Committed in:** `c65e304` (Task 2)

**2. [Rule 3 - Blocking] Missing useRouter import in reader-client.tsx**
- **Found during:** Task 3 (reader-client integration)
- **Issue:** `useRouter` was used on line 26 but not imported from `next/navigation`
- **Fix:** Added `import { useRouter } from "next/navigation"` to the imports
- **Files modified:** `src/components/reader/reader-client.tsx`
- **Verification:** TypeScript compilation passed after fix
- **Committed in:** `9aadd92` (Task 3)

---

**Total deviations:** 2 auto-fixed (2 missing critical/blocking)
**Impact on plan:** Both fixes were type-safety and import issues that would have caused runtime errors. No scope creep.

## Issues Encountered

None — all planned work completed successfully.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Position persistence (READ-05) fully implemented and verified
- All 4 plans for Phase 2 are complete (02-01 through 02-04)
- Phase 2 core reading requirements (READ-01 through READ-05) all implemented
- Ready for Phase 3: AI Explainers

---
*Phase: 02-core-reading*
*Completed: 2026-05-07*
