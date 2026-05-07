---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-05-07T02:14:35.269Z"
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 5
  completed_plans: 0
---

# Project State: BusyReader

**Project:** busyreader-via-pi
**Last updated:** 2026-05-06 (UI-SPEC approved)

---

## Current Phase

**Phase 1: Foundation** — UI design contract approved, ready for planning

Phase 1 delivers authentication, EPUB upload with MD5 deduplication, the Universal Library, Personal Library, basic admin panel, and book language detection. All other phases depend on this foundation.

---

## Phase Status

| Phase | Status | Requirements | Completed | Blockers |
| --- | --- | --- | --- | --- |
| Phase 1: Foundation | UI-SPEC approved | 19 | 0 | None |
| Phase 2: Core Reading | Blocked | 5 | 0 | Phase 1 |
| Phase 3: AI Explainers | Blocked | 8 | 0 | Phase 2 |
| Phase 4: Reading Enhancements | Blocked | 5 | 0 | Phase 3 |
| Phase 5: TTS Audio | Blocked | 9 | 0 | Phase 4 |

---

## Completed Requirements

None yet.

---

## Active Decisions

| Decision | Status | Notes |
| --- | --- | --- |
| Next.js 16 + SQLite + Prisma 5 | Confirmed | Research validated stack |
| Better Auth for RBAC | Confirmed | Prisma adapter available |
| `@likecoin/epub-ts` for EPUB parsing | Confirmed | 970+ tests, TypeScript-strict |
| OpenRouter for LLM abstraction | Confirmed | Tiered model selection |
| MD5 as sole book identifier | Confirmed | Non-negotiable per user mandate |
| Admin-managed roles (no self-serve billing) | Confirmed | v1 scope constraint |

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

*State updates automatically at phase transitions and milestone completions.*
