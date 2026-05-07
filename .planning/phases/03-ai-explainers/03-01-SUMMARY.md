---
phase: 03-ai-explainers
plan: "03-01"
subsystem: database
tags: [prisma, sqlite, better-auth, caching]

requires:
  - phase: "02-core-reading"
    provides: EPUB processing and reader with ToC, TXT conversions stored

provides:
  - Explainer cache table with composite unique key
  - User.preferredLanguage field for per-user language preference
  - Explainer service (cache lookup, write, SHA-256 hash)
  - Prompt builder service (fillTemplate, buildBookPrompt, buildSectionPrompt)
  - Section text extractor (EPUB spine by href)

affects: [03-ai-explainers]

tech-stack:
  added: []
  patterns: [service-layer, cache-lookup, SHA-256 content hash, template substitution]

key-files:
  created:
    - src/server/services/explainer.ts
    - src/server/services/prompt-builder.ts
    - src/server/services/section-extractor.ts
  modified:
    - src/server/db/schema.prisma
    - src/lib/auth.ts
    - src/lib/auth-guards.ts

key-decisions:
  - "Explainer cache key: SHA-256(type + NUL + sourceText + NUL + promptVersion)"
  - "Composite unique: (contentHash, language, contentType, tier)"
  - "NUL byte delimiter between hash components to avoid ambiguity"
  - "Section title resolved from tocJson by href traversal"

patterns-established:
  - "Service layer with typed input/output interfaces exported from each service"
  - "Buffer to ArrayBuffer conversion for Node Buffer passing to @likecoin/epub-ts Book.open()"
  - "fillTemplate using regex /\\{\\{(\\w+)\\}\\}/g with null coalescing fallback"

requirements-completed: [EXP-05, EXP-06, EXP-07, LANG-02]

duration: ~8min
completed: 2026-05-07
---

# Phase 3 Plan 01: Schema & Explainer Service Foundation Summary

**Explainer cache schema with SHA-256 content hashing, per-user language preference, and core service layer for prompt building and section text extraction**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-07
- **Completed:** 2026-05-07
- **Tasks:** 4
- **Files modified:** 6

## Accomplishments
- `Explainer` model with composite unique key `(contentHash, language, contentType, tier)` for universal cache
- `User.preferredLanguage` field with better-auth integration and `AuthenticatedUser` type update
- Explainer service with `getExplainer`, `createExplainer`, `computeContentHash` (SHA-256)
- Prompt builder service with `fillTemplate`, `buildBookPrompt`, `buildSectionPrompt`
- Section text extractor using `@likecoin/epub-ts` spine API with Buffer-to-ArrayBuffer conversion

## Task Commits

1. **Task 03-01-01: Schema migration** - `5e06c45` (feat) — Explainer model + User.preferredLanguage + migration
2. **Task 03-01-02: Explainer service** - `ced0eb6` (feat) — cache lookup/write/hash
3. **Task 03-01-03: Prompt builder service** - `feec5d2` (feat) — fillTemplate + book/section prompts
4. **Task 03-01-04: Section text extraction** - `a1a2ed1` (feat) — EPUB spine text extraction

## Files Created/Modified

- `src/server/db/schema.prisma` - Added `Explainer` model and `preferredLanguage` field on `User`
- `src/lib/auth.ts` - Added `preferredLanguage` to better-auth `additionalFields`
- `src/lib/auth-guards.ts` - Added `preferredLanguage` to `AuthenticatedUser` interface and `requireAuth()`
- `src/server/services/explainer.ts` - Cache CRUD + `computeContentHash` (new)
- `src/server/services/prompt-builder.ts` - `fillTemplate`, `buildBookPrompt`, `buildSectionPrompt` (new)
- `src/server/services/section-extractor.ts` - `extractSectionText` via `@likecoin/epub-ts` spine (new)
- `prisma/migrations/20260507065444_add_explainer_and_language/migration.sql` - Migration applied

## Decisions Made

- SHA-256 over MD5 for content hashing (content hash collision resistance vs file dedup per project mandate)
- NUL byte (`\x00`) delimiter between hash components to prevent cross-boundary collisions
- `tier` included in cache key from the start (future-proofs Pro-tier model access without migration)
- `sectionTitle` resolved from `tocJson` recursively rather than relying on EPUB manifest metadata

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- TypeScript `spineItem.load()` return type was `Element` not `Document` — fixed with `as unknown as` cast
- Prisma schema at non-standard path `src/server/db/schema.prisma` — used `--schema` flag for all prisma CLI commands

## Next Phase Readiness

- Schema and service foundation ready for Plan 03-02 (OpenRouter API integration + SSE streaming)
- All services typed and type-checked clean
- Migration applied and Prisma Client generated

---
*Phase: 03-ai-explainers | Plan: 03-01*
*Completed: 2026-05-07*
