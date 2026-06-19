# Final Review — `feat/design-system-expansion`

**Range reviewed:** `9fe443d..b8ffaa5` (4 commits)
**Plan:** `docs/superpowers/plans/2026-06-19-tweakpane-design-system.md`
**Skill cross-check:** `hansv-tweakpane-adder-v5-2` (boilerplate + v4 API rules)

---

## 1. Spec compliance verdict: ✅ PASS

All 8 global constraints hold. Constraint-by-constraint:

| # | Constraint | Status | Evidence |
|---|-----------|--------|----------|
| 1 | CDN import, no npm dep | ✅ | `package.json` grep for `tweakpane` → empty. Import is `https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js` inside `useEffect` (`page.tsx:~165`), pinned to exact `4.0.5`. |
| 2 | `@theme inline` block untouched | ✅ | `globals.css` diff only touches the `:root` highlighter + status blocks (lines ~105–122). `@theme inline` is elsewhere and unmodified. |
| 3 | 217 baseline tests stay green; hex captions preserved | ✅ | Static captions kept: `<small>{h.hex}</small>` still renders `#19E1CA`/`#FEC405`/`#F168F5` (`page.tsx:564–566`); gradient captions `#FF7A4D` etc. retained. New `page.test.tsx` assertions pass; task-4 report: 256 passed, 0 regressions. |
| 4 | §09 FloatingToolbar swatches stay literal hex | ✅ | `page.tsx:1042`: `{["#19E1CA", "#FEC405", "#F168F5"].map((c) => …)` — literal hex, not converted to vars. Dedicated test at `page.test.tsx` ("leaves §09 FloatingToolbar highlight swatches as literal hex"). |
| 5 | TDD per task | ✅ | All four task reports show RED→GREEN traces; test files (`globals.css.test.ts`, `tweakpane-params.test.ts`, expanded `page.test.tsx`) precede/cover the production code. |
| 6 | No comments except `ponytail:` | ⚠️ | Production code clean. Two minor comment deviations in **test** files (see Minor F4). |
| 7 | Real shared components untouched | ✅ | Imports of `BookCard`, `ReaderSidebar`, `ReaderChrome`, `ReadingProgress`, `BookSettingsPanel`, `DailyDigest` all unchanged (`page.tsx:13–19`). Real `<BookCard>` still used for `demo-0`. Only the two **inline** mirror tiles (`demo-1`/`demo-2`) were edited. |
| 8 | `highlight-colors.ts` untouched | ✅ | Not in the diff. |

Locked user decisions all held: always-on gating (no feature flag), comprehensive scope (`--hl-*` fixed + inline hex refactored to vars), per-section scoped `.ds-gallery` layout knobs, Copy/Paste only (no localStorage).

The Tweakpane boilerplate faithfully follows the skill: `addBindingWithReset`/`enableUnclampedEntry` (config-driven range detection, `input`-event tracking, deferred Enter/blur override, monkey-patched `refresh()`), per-param ⟲ reset, Copy/Paste with textarea fallback + `✓ ✗ ⚠` feedback, draggable title bar with 5px threshold + click suppression. The only deliberate adaptation (`pane.addBinding` → `target.addBinding` via a closure-reassigned folder pointer) is correct and documented in the task-4 report.

---

## 2. Task quality verdict: Approved

Mergeable. One **Important** finding is worth addressing but is designer-facing only (affects two decorative demo tiles in the `/design-system` gallery, zero production surfaces). Everything else is Minor.

---

## 3. Findings

### Critical
None. No security issues (Paste uses `JSON.parse` + key-whitelist + `typeof` check, no `eval`; CDN pinned to exact version), no broken behavior, no test/constraint regressions, SSR/prerender-safe (`useEffect` never runs during `○ Static` prerender; `import type` is erased at build; CSS-var fallbacks in the inline styles double as pre-Tweakpane defaults so there's no flash of wrong values).

### Important

**I1 — BookCard mirror now lifts the whole card, diverging from real BookCard.**
`page.tsx:846–862` (and the `<style>` rules at `:507–512`).
The real `BookCard` (`src/components/library/book-card.tsx`) explicitly lifts **only the cover wrapper**, leaving the progress slot anchored — its own `ponytail:` comment reads *"lift the cover only, not the progress slot."* The plan (Task 3, item 5) accordingly instructed: *"Apply `.ds-book-hover` to the inner wrapper divs."*

The implementer instead put `.ds-book-card` on the **outer `<a>`** (`:846`, `:855`) and applied `transform: translateY(...)` to that element (`:508`). Result: hovering `demo-2` (which has a visible 62% progress bar at `:862`) lifts the cover **and** the progress slot together, unlike production BookCards. For a gallery whose stated job is faithful mirroring, this is a fidelity regression; it also directly contradicts the plan's literal instruction.

Why it matters: a designer dialing `book-hover-lift` here sees different hover kinematics than the real `/library` grid, so the dial is calibrated against the wrong reference.

Suggested fix (small): move the transform target back to the inner div, matching the plan. Either:
- Put `.ds-book-card` (rename or keep) on the inner `<div>` that wraps `.ds-book-shadow`, and scope `:hover` to the ancestor `<a>`; or
- Restore the `group`/`group-hover:` Tailwind mechanism on the outer `<a>` and apply `var(--book-hover-lift)` only to the inner lift, leaving the shadow on `group-hover`.

Either keeps the progress slot anchored. Note: this is designer-facing only — production BookCard is untouched and correct, so deferring is acceptable if the team prioritizes shipping.

### Minor

**M1 — Stale `ponytail:` comment now inaccurate.**
`page.tsx:845`: *"Mirrors BookCard's classes verbatim so the shadow reads identically."* After this refactor the mirror no longer uses BookCard's classes verbatim — `group`/`shadow-book`/`group-hover:shadow-book-lifted` were replaced with `ds-book-card`/`ds-book-shadow` + hardcoded rgba. The shadow **values** are still identical (see M2), but the comment overstates fidelity. Update or delete the comment.

**M2 — `shadow-book` / `shadow-book-lifted` hardcoded as rgba literals instead of using the utilities.**
`page.tsx:509–512`. Values match `globals.css:266–277` exactly (`0 2px 2px rgba(0,0,0,.25), 0 8px 8px rgba(0,0,0,.22)` etc.), so it renders identically **today**. But if the `@utility shadow-book*` tokens ever change, the gallery won't track them (the real BookCard will). The duplication is a reasonable trade-off (the `group-hover:` mechanism that applied the lifted utility was removed), but per project convention it should carry a `ponytail:` comment naming the duplication and the upgrade path (e.g. *`ponytail: shadows hardcoded to mirror @utility shadow-book; re-point at the utility if group-hover is restored`*).

**M3 — Empty `className=""` left on the inner wrapper divs.**
`page.tsx:847`, `:856`. Dead attribute after the transition classes were stripped. Remove it (the element can be a bare `<div>` or collapse entirely).

**M4 — Explanatory (non-`ponytail:`) comments in test files.**
`page.test.tsx` "Task 4 — Tweakpane panel wiring" block has a multi-line `//` comment explaining why the assertions are source-substring-based. Constraint #6 is strict ("No comments … unless `ponytail:`"). The rationale is useful but technically violates the rule. Either prefix with `ponytail:` or move the justification into the test's `describe` name. (Pre-existing `// --reader-sidebar-w` trailing comments in the baseline test are out of scope — not introduced here.)

**M5 — Gallery-scoped setters re-query `.ds-gallery` on every call.**
`tweakpane-params.ts:78–83`: each gallery setter runs `document.querySelector(".ds-gallery")` on every invocation (i.e. every slider tick). Negligible cost for a dev tool, but a one-time cached reference would be cleaner. Worth a `ponytail:` note if left as-is (*`ponytail: querySelector per call; cache the element if dialing ever shows lag`*).

### Non-issues (verified, no action)
- **"Type" folder missing from `TWEAK_FOLDERS`.** The plan's Task-4 prose listed "Type" among folders, but the param inventory defines **no** type tokens (font-size/line-height/etc. aren't in scope). An empty folder would be noise — omitting it was the correct YAGNI call.
- **36 vs 38 token count.** Already resolved as a plan miscount; CONFIG has 36 rows, panel binds all 36 one-to-one. Excluded per brief.
- **`--tts-bar-blur` default 6px vs original 4px.** Explicitly intentional per spec; excluded per brief.
- **SSR/prerender safety.** Verified safe: `useEffect` doesn't run during `○ Static` prerender; `import type` is erased; dynamic `import()` is guarded by `/* @vite-ignore */` and a `disposed` flag checked post-`await` (correct unmount-before-resolve handling without needing an AbortController).
- **`any` leakage.** None in `page.tsx`, `tweakpane-params.ts`, or `tweakpane.d.ts` — all use `unknown`/`Record<string, unknown>`/proper aliases.
- **Status glyphs `✓ ✗ ⚠ ⟲`.** Unicode (escaped as `\u2713` etc.), not emoji — these are the skill's boilerplate; acceptable.

---

## 4. Strengths

- **Clean separation of concerns.** `tweakpane-params.ts` is a pure, framework-agnostic data+setter module (CONFIG-driven, frozen defaults, unit-aware formatting); the React layer only mounts and wires. Easy to test in isolation — and it is (26 parameterized tests).
- **Integration is airtight.** Every gallery-scoped var (`book-hover-lift`, `tts-bar-h`, `tts-bar-blur`, `toolbar-w`, `toolbar-shadow-y`) written by `applyParam` is consumed by exactly one inline style in `page.tsx`, and every root var reaches either a gallery mirror or the `@theme inline` cascade. The `applyParam` key-set and `defaultParams` key-set are asserted equal by test.
- **Defensive defaults.** Inline-style fallbacks (`var(--tts-bar-h, 64px)` etc.) match `defaultParams` exactly, so the gallery renders correctly before Tweakpane's async import resolves — no FOUC, no flash of zero-height bars.
- **Skill fidelity.** The unclamped-entry machinery is ported faithfully, including the subtle monkey-patched `refresh()` that makes pasted out-of-range values survive — the part most implementations get wrong.
- **No scope creep into production code.** Despite touching a gallery that imports real shared components, every real component import and the real `<BookCard>` instance are untouched; only inline mirrors moved.
- **CSS-var fallbacks double as the source of truth** for the pre-Tweakpane render, so SSR output is correct without any client gate.
