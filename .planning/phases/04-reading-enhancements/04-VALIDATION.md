---
phase: 4
slug: reading-enhancements
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-05-07
---

# Phase 4 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                               |
| ---------------------- | --------------------------------------------------- |
| **Framework**          | vitest                                              |
| **Config file**        | `vitest.config.ts`                                  |
| **Quick run command**  | `npm test`                                          |
| **Full suite command** | `npm test`                                          |
| **Estimated runtime**  | ~15 seconds                                         |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID   | Plan | Wave | Requirement | Test Type | Automated Command     | File Exists | Status    |
| --------- | ---- | ---- | ----------- | --------- | --------------------- | ----------- | --------- |
| 04-01-01  | 01   | 1    | READ-06     | unit      | `npm test`            | ✅          | ⬜ pending |
| 04-01-02  | 01   | 1    | READ-07     | unit      | `npm test`            | ✅          | ⬜ pending |
| 04-02-01  | 02   | 2    | READ-08     | unit      | `npm test`            | ✅          | ⬜ pending |
| 04-02-02  | 02   | 2    | EXP-03      | unit      | `npm test`            | ✅          | ⬜ pending |
| 04-03-01  | 03   | 3    | EXP-08      | unit      | `npm test`            | ✅          | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- [x] `vitest.config.ts` — already configured
- [x] `src/server/services/__tests__/` — service test pattern established
- [x] `src/app/api/**/__tests__/` — API route test pattern established

---

## Manual-Only Verifications

| Behavior                  | Requirement | Why Manual                        | Test Instructions                                    |
| ------------------------- | ----------- | --------------------------------- | ---------------------------------------------------- |
| Floating toolbar position | READ-07     | Visual positioning in iframe      | Select text in reader, verify toolbar appears above  |
| Highlight re-render       | READ-07     | Theme change DOM injection        | Add highlight, switch theme, verify highlight persists |
| Search result navigation  | READ-08     | CFI→paragraph→viewport alignment  | Search, click result, verify correct paragraph visible |
| Passage explainer SSE     | EXP-03      | OpenRouter streaming end-to-end   | Select text, click Explain, verify stream renders    |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
