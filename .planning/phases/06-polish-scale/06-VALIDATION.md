---
phase: 6
slug: polish-scale
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-07
---

# Phase 6 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                        |
| ---------------------- | -------------------------------------------- |
| **Framework**          | vitest                                       |
| **Config file**        | vitest.config.ts                             |
| **Quick run command**  | `pnpm test --reporter=verbose 2>&1 \| tail -20` |
| **Full suite command** | `pnpm test`                                  |
| **Estimated runtime**  | ~15 seconds                                  |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test --reporter=verbose 2>&1 | tail -20`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID   | Plan | Wave | Requirement | Test Type     | Automated Command            | File Exists | Status    |
| --------- | ---- | ---- | ----------- | ------------- | ---------------------------- | ----------- | --------- |
| 06-01-01  | 01   | 1    | POL-02      | unit          | `pnpm test library.test.ts`  | ❌ W0        | ⬜ pending |
| 06-01-02  | 01   | 1    | POL-02      | unit          | `pnpm test library.test.ts`  | ❌ W0        | ⬜ pending |
| 06-02-01  | 02   | 1    | POL-05      | unit          | `pnpm test role-badge.test`  | ❌ W0        | ⬜ pending |
| 06-03-01  | 03   | 1    | POL-02      | visual/manual | Manual browser check         | N/A         | ⬜ pending |
| 06-03-02  | 03   | 1    | POL-05      | visual/manual | Manual browser check         | N/A         | ⬜ pending |
| 06-03-03  | 03   | 1    | polish      | visual/manual | Manual browser check         | N/A         | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/server/services/__tests__/library.test.ts` - test for progress computation in getPersonalLibrary
- [ ] `src/components/auth/__tests__/role-badge.test.tsx` - test for RoleBadge rendering per role
- [ ] Existing infrastructure covers all other phase requirements.

---

## Manual-Only Verifications

| Behavior                    | Requirement | Why Manual                | Test Instructions                                          |
| --------------------------- | ----------- | ------------------------- | ---------------------------------------------------------- |
| Progress bar visual         | POL-02      | Visual rendering at scale | Open library, check bar on cards with different %          |
| Bookshelf hover effects     | polish      | CSS transition rendering  | Hover over cards, verify scale + shadow transitions        |
| Pro badge in header         | POL-05      | Layout integration        | Log in as pro/admin/regular, check header badge visibility |
| Card spacing & typography   | polish      | Visual balance            | View bookshelf at multiple viewport widths                 |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
