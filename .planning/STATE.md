---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-05-07T07:03:48.678Z"
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 13
  completed_plans: 11
---

# Project State: BusyReader

**Project:** busyreader-via-pi
**Last updated:** 2026-05-07 (Phase 3 context gathered, ready for planning)

---

## Current Phase

**Phase 3: AI Explainers** — Plans 03-01 and 03-02 complete (2/4 plans). OpenRouter streaming service and generateExplainer orchestration built. Next: Plan 03-03 (API route wrapping SSE).

Phase 1 complete (19/19 requirements). Phase 2 complete (5/5 requirements, 4/4 plans).

---

## Phase Status

| Phase | Status | Requirements | Completed | Blockers |
| --- | --- | --- | --- | --- |
| Phase 1: Foundation | ✅ COMPLETE | 19 | 19 | None |
| Phase 2: Core Reading | ✅ COMPLETE (all 4/4 plans) | 5 | 5 | None |
| Phase 3: AI Explainers | Plans 03-01 and 03-02 done (2/4) | 8 | 6 | — |
| Phase 4: Reading Enhancements | Blocked | 5 | 0 | Phase 3 |
| Phase 5: TTS Audio | Blocked | 9 | 0 | Phase 4 |

---

## Completed Requirements

All Phase 1 requirements (AUTH-01..05, LIB-01..06, ADM-01..07, LANG-03) verified in `01-VERIFICATION.md`.

Phase 3 partial (EXP-04, EXP-05, EXP-06, EXP-07, LANG-02 completed via plans 03-01 and 03-02; remaining via plans 03-03 onwards).

---

## Active Decisions

| Decision | Status | Notes |
| --- | --- | --- |
| Next.js 16 + SQLite + Prisma 5 | Confirmed | Prisma 5.22.0 pinned (NOT 7.x) |
| Better Auth for RBAC | Confirmed | better-auth@1.6.9 installed |
| `@likecoin/epub-ts` for EPUB parsing | Confirmed | @likecoin/epub-ts@0.6.3 installed |
| OpenRouter for LLM abstraction | Confirmed | Will be installed in Phase 3 |
| MD5 as sole book identifier | Confirmed | Non-negotiable per user mandate |
| Admin-managed roles (no self-serve billing) | Confirmed | v1 scope constraint |
| UserRole stored as String (SQLite has no enum) | Confirmed | App-level validation enforces values |
| shadcn/ui with radix-nova preset (slate semantics) | Confirmed | CLI doesn't support --base-color; Nova functionally equivalent |
| Storage abstraction with LocalStorage | Confirmed | StorageProvider interface; LocalStorage implementation |
| `@likecoin/epub-ts` NavItem.label (not title) | Active | ToC entries use `label` field from epub-ts Navigation API |

---

## Active Deviations from Plan

| Deviation | Phase | Impact | Resolution |
| --- | --- | --- | --- |
| @better-auth/cli@1.6.9 not available | 01 | CLI installed as 1.4.21 | Runtime better-auth@1.6.9 unaffected |
| shadcn form component not available | 01 | form.tsx not installed | React Hook Form + zod to be used directly |
| UserRole stored as String | 01 | No schema change | App-level validation enforces valid values |

---

## Open Questions

1. **EPUB parsing robustness** — Need validation with real-world test corpus before user-facing upload.
2. **Prompt engineering quality** — Hallucination resistance strategy needs prototyping with real books.
3. **TTS cost estimation** — Per-character pricing means variable costs; need sample book validation.
4. **Language detection accuracy** — Auto-detection libraries may fail on short texts, mixed-language, or technical content.

---

## Milestones

| Milestone | Target Phase | Status |
| --- | --- | --- |
| First user can upload and read an EPUB | Phase 2 | Pending |
| First Explainer generated and cached | Phase 3 | Pending |
| First TTS audio generated and played | Phase 5 | Pending |
| Admin can manage users and prompts end-to-end | Phase 1 | ✅ Complete |

---

## Key Files (Phase 1 Foundation)

| File | Purpose |
| --- | --- |
| `src/server/db/schema.prisma` | All Prisma models (9 tables including UserBookPosition) |
| `src/server/db/index.ts` | Prisma client singleton |
| `src/server/storage/types.ts` | StorageProvider interface |
| `src/server/storage/local.ts` | LocalStorage implementation |
| `src/lib/utils.ts` | cn() Tailwind utility |
| `src/types/book.ts` | Book, BookWithAccess, UserRole types |
| `components.json` | shadcn/ui config (radix-nova, slate) |
| `src/components/ui/` | 22 shadcn components |
| `vitest.config.ts` | Vitest node environment config |
| `playwright.config.ts` | Playwright chromium config |
| `src/components/reader/toc-panel.tsx` | Left Sheet ToC with recursive entries |
| `src/components/reader/theme-toggle.tsx` | Mount-gated theme cycle button |
| `src/components/reader/reader-skeleton.tsx` | Loading skeleton overlay |
| `src/components/reader/reader-error.tsx` | Error state with Back/Retry |
| `src/components/reader/reader-client.tsx` | Reader orchestrator component |
| `prisma/seed.ts` | 2 PromptTemplate records seeded |

---

## Plan 02-02 Completion

Plan 02-02 (EPUB Viewer, Reader Chrome, Progress Bar) executed 2026-05-07. Commits: `4084a90` (epub-viewer), `6c9f514` (reader-chrome + reading-progress).

Establishes: Custom React wrapper around @likecoin/epub-ts Book + Rendition with full lifecycle (book.destroy on unmount), three themes registered via rendition.themes.register(), EpubViewerHandle.navigateTo() via useImperativeHandle, ReaderChrome h-12 glassmorphism toolbar with slot-based composition, ReadingProgress h-1 bar with 300ms transition. READ-01 and READ-04 implemented.

## Plan 02-04 Completion

Plan 02-04 (Position Persistence) executed 2026-05-07. Commits: `b812401` (position-tracking library), `c65e304` (reader service + API route), `9aadd92` (reader integration).

Establishes: Bidirectional CFI↔paragraph mapping library (buildParagraphMap, cfiToParagraphOffset, paragraphOffsetToCfi), authenticated position CRUD API route (GET/POST), reader components wired with debounced save (3s) and CFI-first instant restore. READ-05 implemented.

## Plan 02-03 Completion

Plan 02-03 (ToC Panel, Theme Toggle, Loading/Error) executed 2026-05-07. Commits: `20d8c6d` (toc-panel), `ce4fe56` (theme-toggle), `d8f53c9` (skeleton, error, reader-client).

Establishes: ToC panel with left Sheet + ScrollArea, mount-gated ThemeToggle cycling light/sepia/dark, ReaderSkeleton + ReaderError overlays, ReaderClient orchestration. READ-01/02/03/04 covered.

## Plan 03-02 Completion

Plan 03-02 (OpenRouter Integration & Generation Orchestration) executed 2026-05-07. Commits: `f93b3a3` (OpenRouter SSE streaming service), `713100b` (generateExplainer orchestrator), `63f5863` (unit tests).

Establishes: `streamExplainer` async generator with SSE parsing from OpenRouter, lazy imports to avoid circular dependency, cache-first `generateExplainer` orchestrator (cache check -> stream -> cache write), `REGULAR_MODEL`/`PRO_MODEL` exports, `OpenRouterError` with statusCode. EXP-04, EXP-06, EXP-07 implemented.

## Plan 03-01 Completion

Plan 03-01 (Schema & Explainer Service Foundation) executed 2026-05-07. Commits: `5e06c45` (Explainer model + User.preferredLanguage + migration), `ced0eb6` (explainer service: getExplainer, createExplainer, computeContentHash), `feec5d2` (prompt builder: fillTemplate, buildBookPrompt, buildSectionPrompt), `a1a2ed1` (section extractor: extractSectionText via @likecoin/epub-ts spine).

Establishes: `Explainer` model with `@@unique([contentHash, language, contentType, tier])`, `User.preferredLanguage` with better-auth integration, SHA-256 content hash computation, template substitution, section text extraction from EPUB spine. EXP-05, EXP-06, EXP-07, LANG-02 implemented.

## Plan 02-01 Completion

Plan 02-01 (Reader Infrastructure) executed 2026-05-07. Commits: `30822a1` (UserBookPosition model), `5003111` (reader route group), `72490e3` (ThemeProvider + Open Reader button).

Establishes: UserBookPosition persistence model, (reader) route group at `/book/[id]/reader`, next-themes ThemeProvider with sepia, enabled Open Reader navigation.

---

*State updates automatically at phase transitions and milestone completions.*
