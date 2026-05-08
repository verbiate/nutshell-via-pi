---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-05-08T01:54:47.949Z"
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 21
  completed_plans: 21
---

# Project State: BusyReader

**Project:** busyreader-via-pi
**Last updated:** 2026-05-08 (Phase 5 complete — 3/3 plans, 9/10 requirements verified, TTS-08 deferred)

---

## Current Phase

**Phase 6: Polish & Scale** — 5 requirements, ready for planning. Cover extraction, progress indicators, tier config, cost tracking, Pro badges.

Phase 1 complete (19/19 requirements). Phase 2 complete (5/5 requirements). Phase 3 complete (8/8 requirements). Phase 4 complete (5/5 requirements). Phase 5 complete (9/10 requirements, 3/3 plans, TTS-08 deferred).

---

## Phase Status

| Phase | Status | Requirements | Completed | Blockers |
| --- | --- | --- | --- | --- |
| Phase 1: Foundation | ✅ COMPLETE | 19 | 19 | None |
| Phase 2: Core Reading | ✅ COMPLETE (all 4/4 plans) | 5 | 5 | None |
| Phase 3: AI Explainers | ✅ COMPLETE (4/4 plans) | 8 | 8 | None |
| Phase 4: Reading Enhancements | ✅ COMPLETE (5/5 plans) | 5 | 5 | None |
| Phase 5: TTS Audio | ✅ COMPLETE (3/3 plans) | 10 | 9 | TTS-08 deferred |
| Phase 6: Polish & Scale | Ready to plan | 5 | 0 | None |

---

## Completed Requirements

All Phase 1 requirements (AUTH-01..05, LIB-01..06, ADM-01..07, LANG-03) verified in `01-VERIFICATION.md`.

All Phase 3 requirements (EXP-01, EXP-02, EXP-04, EXP-05, EXP-06, EXP-07, LANG-01, LANG-02) completed via plans 03-01, 03-02, 03-03, and 03-04.

All Phase 4 requirements (READ-06, READ-07, READ-08, EXP-03, EXP-08) completed via plans 04-01, 04-02, 04-03, 04-04, and 04-05.

All Phase 5 requirements (EXP-09, TTS-01..07, LANG-04) completed via plans 05-01, 05-02, and 05-03. TTS-08 deferred (not v1 scope).

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
| First user can upload and read an EPUB | Phase 2 | ✅ Complete |
| First Explainer generated and cached | Phase 3 | ✅ Complete |
| First TTS audio generated and played | Phase 5 | Pending |
| Cost dashboard and Pro badges live | Phase 6 | Pending |
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

## Plan 03-03 Completion

Plan 03-03 (API Routes) executed 2026-05-07. Commits: `4187ff2` (GET /api/explainers), `27d0fe5` (POST /api/explainers/generate SSE streaming), `d33e6d1` (PATCH /api/user/language), `29fc0ef` (unit tests).

Establishes: GET /api/explainers cache check (validates params, verifies book access, computes content hash, returns cached or 404), POST /api/explainers/generate SSE endpoint (force-dynamic, cache-first via two-step generator.next(), manual ReadableStream framing), PATCH /api/user/language update endpoint (2-char validation, preferredLanguage update). EXP-01, EXP-02, EXP-04, EXP-05, EXP-06, LANG-02 implemented.

## Plan 03-04 Completion

Plan 03-04 (UI Components) executed 2026-05-07. Commits: `c889813` (ExplainerPanel + ExplainerStream + CSS animation), `2e95673` (book-level ExplainerTrigger on book detail page), `20032d5` (section-level trigger in ToC panel), `52cd683` (ProfileModal + UserNav integration).

Establishes: `ExplainerPanel` right-side Sheet (320/400px) with word-by-word CSS fade-in animation, cache check + SSE streaming with AbortController cancellation, language Select, all UI states; `ExplainerTrigger` book-level button on book detail page via `BookActions` client component (Server/Client boundary); Sparkles icon per ToC entry with `md:group-hover:opacity-100` visibility; `ProfileModal` Dialog with avatar, name, RoleBadge, language Select, PATCH /api/user/language persistence with session invalidation. EXP-01, EXP-02, LANG-01 implemented.

Plan 03-02 (OpenRouter Integration & Generation Orchestration) executed 2026-05-07. Commits: `f93b3a3` (OpenRouter SSE streaming service), `713100b` (generateExplainer orchestrator), `63f5863` (unit tests).

Establishes: `streamExplainer` async generator with SSE parsing from OpenRouter, lazy imports to avoid circular dependency, cache-first `generateExplainer` orchestrator (cache check -> stream -> cache write), `REGULAR_MODEL`/`PRO_MODEL` exports, `OpenRouterError` with statusCode. EXP-04, EXP-06, EXP-07 implemented.

## Plan 03-01 Completion

Plan 03-01 (Schema & Explainer Service Foundation) executed 2026-05-07. Commits: `5e06c45` (Explainer model + User.preferredLanguage + migration), `ced0eb6` (explainer service: getExplainer, createExplainer, computeContentHash), `feec5d2` (prompt builder: fillTemplate, buildBookPrompt, buildSectionPrompt), `a1a2ed1` (section extractor: extractSectionText via @likecoin/epub-ts spine).

Establishes: `Explainer` model with `@@unique([contentHash, language, contentType, tier])`, `User.preferredLanguage` with better-auth integration, SHA-256 content hash computation, template substitution, section text extraction from EPUB spine. EXP-05, EXP-06, EXP-07, LANG-02 implemented.

## Plan 05-02 Completion

Plan 05-02 (API Routes) executed 2026-05-07. Commits: `0b86222` (POST /api/tts/generate with cache-first TTS audio generation, cancellation via request.signal, 503 for unconfigured provider), `e15ba29` (GET /api/tts/audio serving cached MP3/WAV with correct Content-Type, auth-gated), `067b76c` (GET+PATCH /api/admin/config with requireAdmin, masked API key audit logging for openrouter/elevenlabs/fal), `5419cde` (22 unit tests across 3 test files, all passing).

Establishes: TTS generation and serving API endpoints (TTS-01, TTS-02), admin-configurable provider API keys and models (TTS-05, EXP-09), synchronous wait-with-feedback pattern (satisfies TTS-07 without async queue). All 100 tests pass.

## Plan 05-03 Completion

Plan 05-03 (UI Components) executed 2026-05-08. Commits: `48eeee3` (shadcn slider), `31224cb` (TtsTrigger + ReaderChrome), `b2f3dce` (useTtsPlayback hook), `731a737` (TtsPlayer bottom bar), `be7bcff` (ReaderClient integration), `4894494` (admin config page + sidebar).

Establishes: TtsTrigger button in ReaderChrome toolbar with idle/generating/disabled states, TtsPlayer h-16 fixed bottom bar with play/pause/scrubber/duration/close, useTtsPlayback state machine (IDLE→GENERATING→READY→PLAYING→ENDED) with auto-advance and pre-buffering, conditional pb-16 on EPUB container, /admin/config page with three tabs (OpenRouter/ElevenLabs/fal.ai) per-tier config cards. TTS-01, TTS-02, TTS-06, LANG-04 implemented. All 100 tests pass.

## Plan 05-01 Completion

Plan 05-01 (Schema & Service Foundation) executed 2026-05-08. Commits: `19712b2` (TtsAudio + TtsProviderConfig + OpenRouterConfig models), `9d2ef9f` (tts.ts service: computeTtsContentHash, chunkText, getTtsAudio, createTtsAudio, getTtsProviderConfig, generateTtsAudio), `73d6cee` (tts-providers.ts: callElevenLabs, callFalAi), `9ddf30a` (openrouter.ts refactor: getOpenRouterConfig, required apiKey/model in StreamExplainerOptions, removed REGULAR_MODEL/PRO_MODEL; explainer.ts uses getOpenRouterConfig), `3d88851` (seed: OpenRouterConfig rows for regular/pro/admin + TtsProviderConfig 6 rows).

Establishes: Three new Prisma models (TtsAudio, TtsProviderConfig, OpenRouterConfig), TTS service with cache-first orchestration, ElevenLabs and fal.ai provider clients with AbortSignal cancellation, OpenRouter refactored to use admin-configurable per-tier API keys and models (EXP-09), seed data for all 9 config rows. TTS-03, TTS-04, TTS-05, TTS-06, EXP-09, LANG-04 implemented.

## Plan 02-01 Completion

Plan 02-01 (Reader Infrastructure) executed 2026-05-07. Commits: `30822a1` (UserBookPosition model), `5003111` (reader route group), `72490e3` (ThemeProvider + Open Reader button).

Establishes: UserBookPosition persistence model, (reader) route group at `/book/[id]/reader`, next-themes ThemeProvider with sepia, enabled Open Reader navigation.

---

*Updated: 2026-05-08 — Phase 5 complete (5/6 phases complete)*
*State updates automatically at phase transitions and milestone completions.*
