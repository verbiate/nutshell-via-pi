---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 1 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                              |
| ---------------------- | ---------------------------------- |
| **Framework**          | vitest (unit) + Playwright (E2E)   |
| **Config file**        | `vitest.config.ts` / `playwright.config.ts` |
| **Quick run command**  | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run && npx playwright test` |
| **Estimated runtime**  | ~30 seconds (unit), ~120 seconds (E2E) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run && npx playwright test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (unit), 120 seconds (E2E)

---

## Per-Task Verification Map

| Task ID   | Plan | Wave | Requirement | Test Type    | Automated Command                          | File Exists | Status    |
| --------- | ---- | ---- | ----------- | ------------ | ------------------------------------------ | ----------- | --------- |
| 1-01-01   | 01   | 1    | AUTH-01..05  | integration  | `npx vitest run src/server/__tests__/auth`  | ❌ W0        | ⬜ pending |
| 1-01-02   | 01   | 1    | AUTH-01..05  | e2e          | `npx playwright test --grep "auth"`        | ❌ W0        | ⬜ pending |
| 1-02-01   | 02   | 1    | LIB-01..04   | unit         | `npx vitest run src/server/__tests__/epub`  | ❌ W0        | ⬜ pending |
| 1-02-02   | 02   | 1    | LIB-01..04   | integration  | `npx vitest run src/server/__tests__/upload`| ❌ W0        | ⬜ pending |
| 1-03-01   | 03   | 1    | LIB-05..06   | e2e          | `npx playwright test --grep "library"`     | ❌ W0        | ⬜ pending |
| 1-04-01   | 04   | 2    | ADM-01..07   | integration  | `npx vitest run src/server/__tests__/admin` | ❌ W0        | ⬜ pending |
| 1-04-02   | 04   | 2    | ADM-01..07   | e2e          | `npx playwright test --grep "admin"`       | ❌ W0        | ⬜ pending |
| 1-05-01   | 05   | 1    | LANG-03      | unit         | `npx vitest run src/server/__tests__/lang`  | ❌ W0        | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/server/__tests__/auth.test.ts` - stubs for AUTH-01..05
- [ ] `src/server/__tests__/epub.test.ts` - stubs for LIB-01..04
- [ ] `src/server/__tests__/upload.test.ts` - stubs for upload integration
- [ ] `src/server/__tests__/admin.test.ts` - stubs for ADM-01..07
- [ ] `src/server/__tests__/lang.test.ts` - stubs for LANG-03
- [ ] `vitest.config.ts` - test framework configuration
- [ ] `playwright.config.ts` - E2E test configuration
- [ ] `e2e/auth.spec.ts` - E2E test stubs for auth flow
- [ ] `e2e/library.spec.ts` - E2E test stubs for library views
- [ ] `e2e/admin.spec.ts` - E2E test stubs for admin panel

---

## Manual-Only Verifications

| Behavior                        | Requirement | Why Manual                | Test Instructions                          |
| ------------------------------- | ----------- | ------------------------- | ------------------------------------------ |
| Google OAuth redirect flow      | AUTH-01     | Requires real Google creds| Sign in with Google, verify redirect back  |
| Upload drag-and-drop feel       | LIB-01      | UX/animation quality      | Drag EPUB onto zone, verify visual feedback|
| Admin sidebar layout on mobile  | ADM-01      | Responsive layout         | Open /admin on mobile viewport             |
| Library grid card visual design | LIB-05      | Visual polish             | View My Library with 5+ books              |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (unit), < 120s (E2E)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
