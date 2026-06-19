# Task 1 Report — Fix `--hl-*` + status gradient stop vars

## Files changed
- `src/app/globals.css` (modified)
- `src/app/globals.css.test.ts` (new)

## Changes
1. `:root` `--hl-*` tokens realigned to `src/components/reader/highlight-colors.ts`:
   - `--hl-teal: #5FC5AE` → `#19E1CA`
   - `--hl-yellow: #EAC85B` → `#FEC405`
   - `--hl-pink: #E79AB7` → `#F168F5`
   - `--hl-green/blue/purple` left untouched (out of scope, unverified).
2. Status block: added `--warn-from`, `--warn-to`, `--success-from`,
   `--success-to`; recomposed `--warn` and `--success` to consume them via
   `var(...)`. Net visual value unchanged.
3. `@theme inline` block untouched. No other files touched.

## TDD
- RED: `src/app/globals.css.test.ts` written first; ran
  `pnpm test src/app/globals.css.test.ts` → 3 failed (missing substrings,
  not typos).
- GREEN: minimal edits applied → 3 passed.
- REFACTOR: none needed.

## Test command + results
- `pnpm test src/app/globals.css.test.ts` → **3/3 passed**.
- `pnpm test` (full suite) → **220 passed / 0 failed tests**, but **1 test
  file failed to compile**: `src/app/design-system/tweakpane-params.test.ts`.
- `pnpm test --exclude "src/app/design-system/tweakpane-params.test.ts"`
  → **38 files / 220 tests passed** (217 original + 3 new).

## Concerns / deviations
1. **Foreign failing test file (Task 2, not mine).**
   `src/app/design-system/tweakpane-params.test.ts` is untracked on this
   branch and imports `./tweakpane-params`, which does not exist yet (it is
   Task 2's deliverable per the plan). I did not create, modify, or commit
   it. It fails at import/compile time, not via any assertion, and is wholly
   outside Task 1's scope. Full-suite `pnpm test` will stay red until Task 2
   lands `tweakpane-params.ts`. Excluding that file, the suite is green.
2. **Deviation from plan's test hint (cosmetic, equivalent).** The plan
   suggested `?raw` import (`import cssRaw from "./globals.css?raw"`) as one
   option. In this vitest config the `?raw` suffix returns an empty string
   (a CSS/Next plugin intercepts `.css` before the raw loader). I used the
   plan's alternative suggestion: `fs.readFileSync` + `import.meta.url`.
   Same substring assertions, same coverage, bulletproof. No change to
   asserted substrings.
3. No other concerns. `page.test.tsx` unaffected (renders no CSS source).

## Commit
`a570ed1` — `fix(design-system): align --hl-* tokens with highlight-colors.ts; decompose status gradients into stop vars`
