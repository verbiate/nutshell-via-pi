---
phase: 03-ai-explainers
plan: "03-03"
subsystem: api
tags: [nextjs, api-routes, sse, streaming, auth-gated, vitest]

requires:
  - phase: "02-core-reading"
    provides: EPUB processing and reader with ToC, TXT conversions stored
  - phase: "03-ai-explainers"
    provides: Explainer service (getExplainer, generateExplainer), OpenRouter streaming service

provides:
  - GET /api/explainers — cache check endpoint with auth gating
  - POST /api/explainers/generate — SSE streaming endpoint with cache-first orchestration
  - PATCH /api/user/language — preferred language update endpoint

affects: [03-ai-explainers, 04-reading-enhancements]

tech-stack:
  added: []
  patterns: [api-routes, sse-streaming, auth-gated-routes, nextjs-app-router, force-dynamic]

key-files:
  created:
    - src/app/api/explainers/route.ts
    - src/app/api/explainers/generate/route.ts
    - src/app/api/user/language/route.ts
    - src/app/api/explainers/__tests__/route.test.ts
    - src/app/api/user/language/__tests__/route.test.ts
  modified: []

key-decisions:
  - "SSE cache hit sends single chunk with cached:true flag rather than omitting flag"
  - "generateExplainer async generator yields full cached content as single string on hit"
  - "ReadableStream manages SSE framing manually using TextEncoder"
  - "POST /api/explainers/generate uses dynamic='force-dynamic' to prevent Next.js response buffering"

patterns-established:
  - "Auth-gated API routes with query param validation and SSE error responses"
  - "SSE stream with force-dynamic export and ReadableStream manual framing"
  - "Cache hit detection via two-step generator.next() pattern"

requirements-completed: [EXP-01, EXP-02, EXP-04, EXP-05, EXP-06, LANG-02]

duration: 2 min
completed: 2026-05-07
---

# Phase 3 Plan 03: API Routes Summary

**Authenticated API surface for explainer cache checks, SSE streaming generation, and language preference updates**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-07T07:07:25Z
- **Completed:** 2026-05-07T07:09:32Z
- **Tasks:** 4
- **Files modified:** 5

## Accomplishments
- GET /api/explainers cache check endpoint with book/section type routing and content hash computation
- POST /api/explainers/generate SSE streaming endpoint with cache hit/miss discrimination
- PATCH /api/user/language preferred language update endpoint with 2-char code validation
- Unit tests for all three API routes (5 tests, all passing)

## Task Commits

Each task was committed atomically:

1. **Task 03-03-01: GET /api/explainers — cache check** - `4187ff2` (feat)
2. **Task 03-03-02: POST /api/explainers/generate — SSE streaming** - `27d0fe5` (feat)
3. **Task 03-03-03: PATCH /api/user/language — update preferred language** - `d33e6d1` (feat)
4. **Task 03-03-04: API route unit tests** - `29fc0ef` (test)

## Files Created/Modified

- `src/app/api/explainers/route.ts` - GET endpoint: validates params, verifies book access, computes content hash, checks cache, returns cached explainer or 404
- `src/app/api/explainers/generate/route.ts` - POST SSE endpoint with `force-dynamic`, consumes generateExplainer async generator, discriminates cache hit/miss via two-step next() pattern
- `src/app/api/user/language/route.ts` - PATCH endpoint: validates 2-char language code, updates User.preferredLanguage, returns updated user
- `src/app/api/explainers/__tests__/route.test.ts` - 3 tests: missing bookId, cache hit, cache miss
- `src/app/api/user/language/__tests__/route.test.ts` - 2 tests: invalid language, successful update

## Decisions Made

- SSE cache hit sends `{ chunk, cached: true }` event to allow client-side discrimination without a separate HTTP response code
- `generateExplainer` async generator yields cached content as single string on hit; two `next()` calls distinguish hit (second done=true) from miss (second done=false with a chunk)
- Manual `ReadableStream` framing using `TextEncoder` rather than any SSE library
- `export const dynamic = "force-dynamic"` on SSE route prevents Next.js from buffering the stream response

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Initial test mock for `@/server/storage/local` used incorrect module shape (`{ storage: { read: fn } }`) causing `storage.read` to return undefined. Fixed by removing module mock and using `vi.spyOn(storage, "read")` on the real imported module instead.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All Phase 3 API routes complete. Next plan (03-04) will build frontend ExplainerTrigger and ExplainerPanel components.
- All routes are auth-gated and verify book access before returning explainer data.
- TypeScript check clean with `npx tsc --noEmit`.

---
*Phase: 03-ai-explainers | Plan: 03-03*
*Completed: 2026-05-07*
