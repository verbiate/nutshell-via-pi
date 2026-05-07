---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-05-07T00:50:00Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 9
  completed_plans: 7
---

# Project State: BusyReader

**Project:** busyreader-via-pi
**Last updated:** 2026-05-07 (Phase 2 context gathered, ready for planning)

---

## Current Phase

**Phase 2: Core Reading** — Plans 01, 02, 03 complete. Reader UI components (ToC panel, theme toggle, skeleton, error) built and wired.

Phase 1 complete (19/19 requirements). Phase 2 context captured: EPUB-native rendering, full-screen immersive reader with slide-out ToC, three themes (light/dark/sepia), content-based position persistence.

---

## Phase Status

| Phase | Status | Requirements | Completed | Blockers |
| --- | --- | --- | --- | --- |
| Phase 1: Foundation | ✅ COMPLETE | 19 | 19 | None |
| Phase 2: Core Reading | In progress (3/3 plans) | 5 | 3 | None |
| Phase 3: AI Explainers | Blocked | 8 | 0 | Phase 2 |
| Phase 4: Reading Enhancements | Blocked | 5 | 0 | Phase 3 |
| Phase 5: TTS Audio | Blocked | 9 | 0 | Phase 4 |

---

## Completed Requirements

All Phase 1 requirements (AUTH-01..05, LIB-01..06, ADM-01..07, LANG-03) verified in `01-VERIFICATION.md`.

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

## Plan 02-03 Completion

Plan 02-03 (ToC Panel, Theme Toggle, Loading/Error) executed 2026-05-07. Commits: `20d8c6d` (toc-panel), `ce4fe56` (theme-toggle), `d8f53c9` (skeleton, error, reader-client), `a2b7c36` (session.id fix).

Establishes: ToC panel with left Sheet + ScrollArea, mount-gated ThemeToggle cycling light/sepia/dark, ReaderSkeleton + ReaderError overlays, ReaderClient orchestration. READ-01/02/03/04 covered. READ-05 (position persistence) remaining.

## Plan 02-01 Completion

Plan 02-01 (Reader Infrastructure) executed 2026-05-07. Commits: `30822a1` (UserBookPosition model), `5003111` (reader route group), `72490e3` (ThemeProvider + Open Reader button).

Establishes: UserBookPosition persistence model, (reader) route group at `/book/[id]/reader`, next-themes ThemeProvider with sepia, enabled Open Reader navigation.

---

*State updates automatically at phase transitions and milestone completions.*
