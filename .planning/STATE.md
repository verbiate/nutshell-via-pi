---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-05-07T22:54:00.000Z"
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 5
  completed_plans: 4
---

# Project State: BusyReader

**Project:** busyreader-via-pi
**Last updated:** 2026-05-07 (Plan 01-04 of Phase 1 completed — Admin Panel)

---

## Current Phase

**Phase 1: Foundation** — Plan 01-04 complete. Admin Panel fully implemented with user management, Universal Library view, prompt template editor, and audit log viewer.

Phase 1 delivers authentication, EPUB upload with MD5 deduplication, the Universal Library, Personal Library, basic admin panel, and book language detection. All other phases depend on this foundation.

---

## Phase Status

| Phase | Status | Requirements | Completed | Blockers |
| --- | --- | --- | --- | --- |
| Phase 1: Foundation | Plan 01-04 COMPLETE | 19 | 0 | None |
| Phase 2: Core Reading | Blocked | 5 | 0 | Phase 1 |
| Phase 3: AI Explainers | Blocked | 8 | 0 | Phase 2 |
| Phase 4: Reading Enhancements | Blocked | 5 | 0 | Phase 3 |
| Phase 5: TTS Audio | Blocked | 9 | 0 | Phase 4 |

---

## Completed Requirements

None yet — Phase 1 plan 01 was scaffolding only.

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
| Admin can manage users and prompts end-to-end | Phase 1 | Pending |

---

## Key Files (Phase 1 Foundation)

| File | Purpose |
| --- | --- |
| `src/server/db/schema.prisma` | All Prisma models (8 tables) |
| `src/server/db/index.ts` | Prisma client singleton |
| `src/server/storage/types.ts` | StorageProvider interface |
| `src/server/storage/local.ts` | LocalStorage implementation |
| `src/lib/utils.ts` | cn() Tailwind utility |
| `src/types/book.ts` | Book, BookWithAccess, UserRole types |
| `components.json` | shadcn/ui config (radix-nova, slate) |
| `src/components/ui/` | 22 shadcn components |
| `vitest.config.ts` | Vitest node environment config |
| `playwright.config.ts` | Playwright chromium config |
| `prisma/seed.ts` | 2 PromptTemplate records seeded |

---

*State updates automatically at phase transitions and milestone completions.*
