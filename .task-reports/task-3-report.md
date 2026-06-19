# Task 3 Report — Refactor `page.tsx` to consume CSS vars + `.ds-gallery` wrapper

**Branch:** `feat/design-system-expansion`
**Commit:** `1c2fca7`
**Status:** DONE

## Files changed

1. `src/app/design-system/page.tsx` — refactored inline hex/literals to `var(...)`; added `.ds-gallery` wrapper class; added scoped `<style>` block; converted §06/§07/§09 inline mirrors to consume scoped vars.
2. `src/app/design-system/__tests__/page.test.tsx` — added 8 new test cases (no existing assertions removed or weakened).

## Refactor points completed (A–G checklist)

- **A.** `.ds-gallery` class added to outer wrapper (`<div className="ds-gallery min-h-screen text-ink">`). Scoped `<style>` block added as first child inside the wrapper, containing `.ds-book-card` transform / `.ds-book-shadow` rules.
- **B.** §01 Highlighters — array entries gained `varName` (`--hl-teal`/`--hl-yellow`/`--hl-pink`); swatch `backgroundColor` now `` `var(${h.varName})` ``. `<small>{h.hex}</small>` caption untouched (still emits `#19E1CA`/`#FEC405`/`#F168F5`).
- **C.** §01 Gradient stops — same pattern (`--g1`/`--g2`/`--g3`); `<small>{g.hex}</small>` caption untouched (still emits `#FF7A4D`/`#FF4E8C`/`#C932A6`).
- **D.** §01 Status pills — `linear-gradient(90deg, var(--warn-from), var(--warn-to))` and `linear-gradient(90deg, var(--success-from), var(--success-to))`.
- **E.** §06 BookCard inline mirrors (demo-1 + demo-2) — `group` → `ds-book-card` on the `<a>`; inner wrapper divs cleared of transform classes; innermost div switched from `shadow-book ... group-hover:shadow-book-lifted` to `ds-book-shadow`. Scoped CSS drives hover lift via `var(--book-hover-lift, 1%)` and shadow swap. Imported `<BookCard id="demo-0">` untouched.
- **F.** §07 TTS bar — `h-16` and `backdrop-blur-sm` removed from className; inline `style={{ height: "var(--tts-bar-h, 64px)", backdropFilter: "blur(var(--tts-bar-blur, 6px))" }}` added.
- **G.** §09 FloatingToolbar mirror — `w-[220px]` and `shadow-[0_8px_30px_-6px_rgba(43,28,17,0.25)]` removed from className; inline `style={{ width: "var(--toolbar-w, 220px)", boxShadow: "0 var(--toolbar-shadow-y, 8px) 30px -6px rgba(43,28,17,0.25)" }}` added. Three highlight swatches at the bottom left untouched (still literal hex per constraint #4).

## TDD process

1. **RED:** Added 8 new test cases (3 highlighter/gradient/status-var assertions inside "Foundations — extended tokens"; 4 wrapper/layout-var assertions in new "Gallery scoped wrapper and layout vars" describe block; 1 §09 literal-hex regression test). Ran `pnpm test src/app/design-system/__tests__/page.test.tsx` — 7 of the 8 failed (the §09 regression already passed since literals were already present). Confirmed each failure was due to the `var(--...)` substring being absent.
2. **GREEN:** Applied refactor edits A–G. Re-ran the file — all 28 tests pass.
3. **REFACTOR:** None needed.

## Verification

- `pnpm test src/app/design-system/__tests__/page.test.tsx --run` → **28 passed (28)**.
- `pnpm test --run` (full suite) → **251 passed (251)** across 39 files. All prior assertions intact (`#19E1CA`/`#FEC405`/`#F168F5`/`#FF7A4D`/`#FF4E8C`/`#C932A6` preserved via static `<small>` captions and the untouched §09 swatches).
- `pnpm build` → succeeds; `/design-system` prerenders as static. TypeScript clean.

## Concerns (non-blocking)

1. **Stale caption in §06 (lines 483–484).** The explanatory `<p>` below the BookCard grid still tells visitors the lift is achieved via `group-hover:-translate-y-[1%]` on the outer wrapper and `group-hover:shadow-book-lifted` on the inner. Those classes are no longer on the elements — the behavior is now driven by `.ds-book-card`/`.ds-book-shadow` scoped CSS. The **visible behavior is identical at default** (`--book-hover-lift: 1%`, and the scoped shadow values were copied verbatim from `globals.css:266-275`'s `shadow-book`/`shadow-book-lifted` `@utility` tokens, so the shadow reads the same). Out of scope to rewrite per the task's A–G list; flagging for the end-of-plan visual pass.
2. **`--tts-bar-blur` default is 6px, not the prior `backdrop-blur-sm` 4px.** This is intentional per the task spec (point F) and `tweakpane-params.ts:57`. The gallery's default backdrop blur is now slightly stronger than before Tweakpane is wired. Not a layout issue — decorative only.
