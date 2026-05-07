---
phase: 3
slug: ai-explainers
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-07
---

# Phase 3 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                               |
| ---------------------- | --------------------------------------------------- |
| **Framework**          | vitest |
| **Config file**        | vitest.config.ts |
| **Quick run command**  | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime**  | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID   | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status    |
| --------- | ---- | ---- | ----------- | --------- | ----------------- | ----------- | --------- |
| 03-01-01  | 01   | 1    | EXP-05/06   | unit      | `npx vitest run src/server/services/__tests__/explainer` | ❌ W0 | ⬜ pending |
| 03-01-02  | 01   | 1    | EXP-05/06   | unit      | `npx vitest run src/server/services/__tests__/explainer` | ❌ W0 | ⬜ pending |
| 03-02-01  | 02   | 1    | EXP-04/07   | unit      | `npx vitest run src/server/services/__tests__/explainer` | ❌ W0 | ⬜ pending |
| 03-02-02  | 02   | 1    | EXP-04/07   | unit      | `npx vitest run src/server/services/__tests__/explainer` | ❌ W0 | ⬜ pending |
| 03-03-01  | 03   | 2    | EXP-01/02   | unit      | `npx vitest run src/app/api/explainer/__tests__` | ❌ W0 | ⬜ pending |
| 03-04-01  | 04   | 2    | LANG-01/02  | unit      | `npx vitest run src/app/api/profile/__tests__` | ❌ W0 | ⬜ pending |
| 03-05-01  | 05   | 3    | EXP-01/02   | e2e       | manual verify | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/server/services/__tests__/explainer.test.ts` - stubs for cache lookup, cache write, OpenRouter streaming
- [ ] `src/app/api/explainer/__tests__/route.test.ts` - stubs for API route handlers
- [ ] `src/app/api/profile/__tests__/language.test.ts` - stubs for language preference API

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior   | Requirement | Why Manual | Test Instructions |
| ---------- | ----------- | ---------- | ----------------- |
| Streaming text appears with word-by-word animation | EXP-01/02 | Requires visual rendering | Open reader, click "Explain this to me", verify animated text streaming in the UI |
| Language preference modal opens from Library view | LANG-01 | Requires UI interaction | Navigate to Library, open profile modal, verify language selector works |
| Language preference modal opens from Reader view | LANG-01 | Requires UI interaction | Open reader, open profile modal from reader chrome, verify language selector |
| Cached Explainer loads instantly on second request | EXP-05 | Requires timing verification | Request Explainer, wait for completion, request again — verify no spinner |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
