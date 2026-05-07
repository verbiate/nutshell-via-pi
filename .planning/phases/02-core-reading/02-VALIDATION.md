---
phase: 2
slug: core-reading
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-07
---

# Phase 2 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                               |
| ---------------------- | --------------------------------------------------- |
| **Framework**          | Vitest (unit) + Playwright (E2E)                    |
| **Config file**        | `vitest.config.ts` / `playwright.config.ts`         |
| **Quick run command**  | `npm test`                                          |
| **Full suite command** | `npm run test:e2e`                                  |
| **Estimated runtime**  | ~15 seconds unit / ~30 seconds E2E                  |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm run test:e2e`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID   | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status    |
| --------- | ---- | ---- | ----------- | --------- | ----------------- | ----------- | --------- |
| 02-01-01  | 01   | 1    | READ-01     | unit      | `npm test`        | ❌ W0       | ⬜ pending |
| 02-01-02  | 01   | 1    | READ-03     | unit      | `npm test`        | ❌ W0       | ⬜ pending |
| 02-02-01  | 02   | 1    | READ-02     | unit      | `npm test`        | ❌ W0       | ⬜ pending |
| 02-02-02  | 02   | 1    | READ-04     | e2e       | `npm run test:e2e`| ❌ W0       | ⬜ pending |
| 02-03-01  | 03   | 2    | READ-05     | unit      | `npm test`        | ❌ W0       | ⬜ pending |
| 02-03-02  | 03   | 2    | READ-05     | e2e       | `npm run test:e2e`| ❌ W0       | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/reader/position-tracking.test.ts` - unit tests for `cfiToParagraphOffset` / `paragraphOffsetToCfi`
- [ ] `src/lib/reader/theme-manager.test.ts` - unit tests for theme registration and switching
- [ ] `e2e/reader.spec.ts` - Playwright flow: library → book → reader → ToC → theme toggle
- [ ] `vitest.config.ts` - ensure Vitest config covers `src/lib/reader/` tests

---

## Manual-Only Verifications

| Behavior                | Requirement | Why Manual                      | Test Instructions                                      |
| ----------------------- | ----------- | ------------------------------- | ------------------------------------------------------ |
| Typography polish       | READ-01     | Visual quality subjective       | Open reader, verify line length ~65ch, margins, no FOUT |
| Theme instant switch    | READ-02     | Perceived speed subjective      | Toggle themes, confirm no flash/reload                 |
| Position resume accuracy| READ-05     | Exact pixel match unreliable    | Close at paragraph 147, reopen, verify same text visible |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
