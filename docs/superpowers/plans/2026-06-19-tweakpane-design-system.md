# Tweakpane on `/design-system`

**Goal:** Add a comprehensive, draggable Tweakpane 4.0.5 control panel to the
`/design-system` gallery so every visible design token can be dialed live.
Values write to CSS custom properties on `:root` (or scoped `.ds-gallery` for
gallery-only tweaks), which Tailwind 4's `@theme inline` layer picks up
everywhere.

**Branch:** `feat/design-system-expansion` (already current)

## User decisions (locked)

- **Gating:** Always-on (Tweakpane loads for any visitor to `/design-system`).
- **Scope:** Comprehensive (fix the latent `--hl-*` bug; refactor inline hex
  in `page.tsx` to consume CSS vars).
- **Per-section controls:** Yes — expose gallery-mirror layout knobs
  (BookCard hover lift %, TTS bar height/blur, toolbar width/shadow) via
  scoped `.ds-gallery` vars. Real shared components stay untouched.
- **Persistence:** Copy / Paste buttons only (skill default). No localStorage.

## Global constraints

1. **CDN import, no npm dep.** Tweakpane loads via ESM from
   `https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js`
   inside a `useEffect`. Do NOT add tweakpane to `package.json`.
2. **Tailwind 4 token cascades must keep working.** Writing
   `document.documentElement.style.setProperty('--paper', '#...')` must
   propagate to `bg-paper` etc. via the existing `@theme inline` mapping.
   Do NOT restructure `globals.css`'s `@theme inline` block.
3. **Existing 217 tests must stay green.** The `page.test.tsx` assertions
   for `#19E1CA`, `#FEC405`, `#F168F5`, `#FF7A4D`, `#FF4E8C`, `#C932A6`,
   `#FBF7EC`, `#F4EEDC`, `#2B1C11`, `#ECE8FB`, `#7E70EA`, `10px`, `16px`,
   `22px`, `999px`, `94px`, `400px`, `250ms` must keep passing. These stay
   in the rendered output via static default-value captions.
4. **§09 FloatingToolbar highlight swatches stay as literal hex** — they
   mirror the real toolbar which consumes `highlight-colors.ts` literals.
   Do not convert these to vars (would break `page.test.tsx:142-144` and
   would misrepresent the runtime).
5. **TDD per task.** Each task writes a failing test first, watches it fail,
   implements minimal code to pass, watches it pass. No production code
   without a failing test first.
6. **No comments in code** unless marking a deliberate simplification with
   `ponytail:` prefix (project convention from AGENTS.md).
7. **Real shared components untouched.** `BookCard`, `ReaderSidebar`,
   `ReaderChrome`, `ReadingProgress`, `BookSettingsPanel`, `DailyDigest`
   imports stay as-is. Only the gallery inline mirrors get scoped vars.
8. **highlight-colors.ts untouched.** It remains the runtime source for the
   reader. CSS vars are for CSS consumers only.

## Task breakdown

### Task 1 — Fix `--hl-*` + add status gradient stop vars in `globals.css`

**File:** `src/app/globals.css`

**Changes:**
- `--hl-teal: #5FC5AE` → `#19E1CA`
- `--hl-yellow: #EAC85B` → `#FEC405`
- `--hl-pink: #E79AB7` → `#F168F5`
- Add four new vars in the Status block:
  ```css
  --warn-from: #FF6A5E;
  --warn-to:   #FF2E7E;
  --success-from: #4FD18B;
  --success-to:   #2FA86A;
  --warn:    linear-gradient(90deg, var(--warn-from), var(--warn-to));
  --success: linear-gradient(90deg, var(--success-from), var(--success-to));
  ```

**TDD:** Add a new test file `src/app/globals.css.test.ts` (or co-located)
that reads `globals.css` as text and asserts:
- `--hl-teal: #19E1CA` (and yellow/pink)
- `--warn-from`, `--warn-to`, `--success-from`, `--success-to` all present
- `--warn:` and `--success:` compose from the new stop vars

This is a string-substring test on the CSS source — coarse but adequate
for catching regressions to the literal token values.

### Task 2 — Create `tweakpane-params.ts` module (TDD-pure)

**File (new):** `src/app/design-system/tweakpane-params.ts`

Exports:
- `defaultParams: Readonly<Record<string, string | number>>` — frozen object
  with every tweakable token and its current default value, keyed by token
  name (e.g. `{ paper: '#FBF7EC', 'r-md': 16, ... }`).
- `applyParam: Record<string, (value: string | number) => void>` — map from
  param key to a function that writes the value to the right CSS property
  on `document.documentElement` (and to the `.ds-gallery` root for scoped
  layout knobs). Each setter formats the value (numbers get `px` or `ms`
  units depending on the token).

**Param inventory (keys → default → target property:**
- Surfaces: `paper`, `paper-deep`, `espresso`, `ink`, `line`, `line-soft`
  → `--<name>` as-is (string hex)
- Lavender: `lav`, `lav-soft`, `lav-ring` → `--<name>` (string hex)
- Gradient: `g1`, `g2`, `g3` → `--g1/g2/g3` (string hex)
- Brand: `b-orange`, `b-magenta`, `b-purple`, `b-blue`, `b-teal`
  → `--<name>` (string hex)
- Highlighters: `hl-teal`, `hl-yellow`, `hl-pink` → `--hl-<name>` (string hex)
- Status: `warn-from`, `warn-to`, `success-from`, `success-to`
  → `--<name>` (string hex)
- Radii: `r-sm`, `r-md`, `r-lg` → `--r-<name>` (number, `${v}px`)
- shadcn radius: `radius` → `--radius` (number, `${v}rem` — note rem unit)
- Reader geometry: `reader-rail-w`, `reader-sidebar-w` → `--reader-<name>`
  (number, `${v}px`); `reader-dur` → `--reader-dur` (number, `${v}ms`)
- Gallery-scoped layout (target `.ds-gallery` element, not `:root`):
  - `book-hover-lift` (number, percent used in `translateY(-${v}%)`)
  - `tts-bar-h` (number px)
  - `tts-bar-blur` (number px)
  - `toolbar-w` (number px)
  - `toolbar-shadow-y` (number px, used in shadow offset)

**TDD:** New test file `src/app/design-system/tweakpane-params.test.ts`:
1. `defaultParams` is frozen (mutation throws in strict mode / no-op).
2. `defaultParams` contains every key listed above with correct values.
3. Each `applyParam[key]` calls
   `document.documentElement.style.setProperty('--<name>', expectedFormat)`
   with the right formatted string. Use a jsdom-like mock or vitest's
   happy-dom (already configured) and spy on `setProperty`.
4. The gallery-scoped keys write to a different target (the `.ds-gallery`
   element) — verify by mocking `document.querySelector`.

### Task 3 — Refactor `page.tsx` inline hex → var() + `.ds-gallery` wrapper

**File:** `src/app/design-system/page.tsx`

**Changes:**
1. Wrap the outer `<div className="min-h-screen ...">` (or add an inner
   wrapper) with `className="ds-gallery"` so scoped vars have a target.
2. **§01 Foundations — Highlighters block (lines ~169-178):** change
   `<span ... style={{ backgroundColor: h.hex }} />` to read
   `var(--hl-teal)` etc. The `<small>{h.hex}</small>` caption STAYS as the
   static default string (`#19E1CA` etc.) — this keeps the test passing.
3. **§01 Foundations — Gradient stops block (lines ~184-198):** same
   pattern — swatch consumes `var(--g1)` etc., caption stays static default.
4. **§01 Foundations — Status pills (lines ~204-206):** replace
   `linear-gradient(90deg, #FF6A5E, #FF2E7E)` with
   `linear-gradient(90deg, var(--warn-from), var(--warn-to))`; same for
   success.
5. **§06 Library inline BookCard mirrors (lines ~452-472):** replace
   `group-hover:-translate-y-[1%]` with an inline CSS var consumption
   pattern. Since Tailwind arbitrary values can't read runtime vars easily,
   use a small inline `<style>` scoped to `.ds-gallery` that defines
   `.ds-book-hover { transition: transform 0.2s; }` and
   `.ds-book-hover:hover { transform: translateY(calc(-1 * var(--book-hover-lift, 1%))); }`.
   Apply `.ds-book-hover` to the inner wrapper divs.
6. **§07 Reader chrome TTS bar (line ~543):** change `h-16` and
   `backdrop-blur-sm` to consume `var(--tts-bar-h)` and
   `var(--tts-bar-blur)` via inline style.
7. **§09 Selection FloatingToolbar mirror (lines ~625-648):** change the
   toolbar width `w-[220px]` and shadow `0_8px_30px...` to consume
   `var(--toolbar-w)` and `var(--toolbar-shadow-y)`. **Leave the three
   highlight swatches at the bottom (line 644) as literal hex** per
   constraint #4.

**TDD:** Update `src/app/design-system/__tests__/page.test.tsx` to ADD
new assertions (don't remove existing ones):
- Rendered HTML contains `var(--hl-teal)` (and yellow, pink)
- Rendered HTML contains `var(--g1)` (and g2, g3)
- Rendered HTML contains `var(--warn-from)` and `var(--success-from)`
- Rendered HTML contains `className="ds-gallery"` or `ds-gallery` somewhere
- §09 still contains literal `#19E1CA` (unchanged assertion)

Write the new assertions first, watch them fail, then refactor the JSX.

### Task 4 — Mount Tweakpane in `useEffect`

**File:** `src/app/design-system/page.tsx`

**Changes:**
1. Import `defaultParams`, `applyParam` from `./tweakpane-params`.
2. Add a `useEffect` (no deps → runs once on mount) that:
   - Dynamically imports Tweakpane from the CDN URL.
   - Creates a `Pane({ title: 'Nutshell Design System' })`.
   - Builds folders per group (Surfaces, Lavender, Gradient, Brand,
     Highlighters, Status, Radii, Reader geometry, Type, Gallery layout).
   - For each param, calls `pane.addBinding(params, key, config)` with
     appropriate config (color picker for hex strings, slider+step for
     numbers, min/max set to "comfortable drag range" per skill).
   - Adds per-binding reset button, enables unclamped text entry.
   - Adds Copy / Paste buttons (skill boilerplate).
   - Makes the pane draggable via title bar (skill boilerplate).
3. Add a `<style>` block (or styled-jsx) at the top of the returned JSX
   containing: Tweakpane reset button CSS (`.tp-reset-button {...}`) and
   the pane's fixed top-right positioning.
4. Apply defaults on mount by iterating `applyParam` and calling each with
   `defaultParams[key]`.
5. `params` object: a mutable copy of `defaultParams` held in a `useRef` so
   Tweakpane can mutate it without React re-renders.

**TDD:** The Tweakpane mount itself is imperative DOM/CDN code and resists
unit testing. Acceptable test surface:
- Page module imports `defaultParams` and `applyParam` from the params
  module (lightweight import-check test, or rely on Task 2's tests + build).
- `pnpm build` (TS check) passes — type-correctness of the mount code.
- `pnpm lint` passes.

The Tweakpane behavior (drag, Copy/Paste round-trip) is verified manually
by visiting `/design-system`. The skill boilerplate is battle-tested.

## Verification (end of plan)

- `pnpm test` — all 217 + new tests green
- `pnpm lint` — clean
- `pnpm build` — TS check passes
- Visit `/design-system` — pane loads top-right, draggable, sliders/swatches
  update live, Copy/Paste round-trips JSON, per-param reset works

## Skipped (YAGNI)

- npm install of tweakpane (CDN import per skill)
- localStorage persistence (Copy/Paste only per user decision)
- Refactoring `highlight-colors.ts` (reader stays on literals)
- Touching real shared components (only gallery mirrors get scoped vars)
- Per-section folders for Tabs/Slider/Ask-bar internals (foundational
  tokens cover the visible cases; can add later if dialing reveals gaps)
