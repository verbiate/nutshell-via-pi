# Nutshell Design Language — Phase 1 (Foundations) Plan

**Goal:** Establish the Nutshell design language (warm paper palette, DM Sans + IBM Plex Serif, coral→magenta gradient, lavender active ring) as the app's real light theme, restyle the primitives that already have live consumers, and ship a lean `/design-system` gallery as the visual check.

**Architecture:** Override `:root` tokens directly so Nutshell paper becomes the light theme (live screens inherit it — accepted interim half-rebrand). Map new tokens into Tailwind v4 `@theme inline` for utilities. Because existing primitives are token-driven, most restyle is automatic; only `button.gradient` and the slider gradient-range are real code additions. All domain components (book-cover, chapter-row, highlight-card, tool-rail, scrubber, search-bar) are deferred to the phases that consume them (Library → Reader).

**Tech Stack:** Next.js 16, React 19, Tailwind v4 (`@theme inline`), shadcn (radix-nova), Radix UI, CVA, lucide-react, `next/font` (DM Sans, IBM Plex Serif). Tests: Vitest (Phase 1 has no branch/loop/parser/security logic → no unit tests).

## Global Constraints

- Palette source-of-truth = reference hex in `.wip-reference/pseudo-components-reference.html` (lines 11–60); structured so exact brand tokens swap in later.
- Scope `:root` only — `.dark`/`.sepia` untouched this phase (toggling to them stays neutral until a later phase warms them).
- Body iridescent wash is **gallery-only** (not on global `<body>`).
- Copy rules: serif for headings/book copy/quotes, sans for UI; gradient reserved for primary action + progress; lavender ring for active tool.
- Package manager: **pnpm**. Pinned versions — do not bump (Prisma 5.22, Next 16, etc.).
- Never call Explainers "summaries" (product rule — observed throughout).

## File Structure

**Modify:** `src/app/globals.css` (tokens + @theme + .bg-grad), `src/app/layout.tsx` (fonts), `src/components/ui/button.tsx` (gradient variant), `src/components/ui/slider.tsx` (gradient range).
**Create:** `src/components/ui/radio-group.tsx`, `src/components/ui/toggle-group.tsx`, `src/app/design-system/page.tsx`.
**No code change (token-driven, verify only):** `card.tsx`, `tabs.tsx` (already has `default`+`line`), `input.tsx`, `badge.tsx`, `separator.tsx`.

## Tasks

1. **Tokens** — `:root` paper palette + additive Nutshell tokens + `@theme inline` color/shadow/font mappings + `.bg-grad` utility. Commit `feat(tokens): adopt Nutshell paper palette as light theme`.
2. **Fonts** — `layout.tsx`: Geist → DM_Sans (`--font-sans`) + IBM_Plex_Serif (`--font-serif`). Commit `feat(fonts): swap Geist for DM Sans + IBM Plex Serif`.
3. **Button gradient variant** — add `gradient` to CVA. Commit `feat(button): add coral-to-magenta gradient variant`.
4. **Slider gradient range** — Range `bg-primary` → `bg-grad`. Commit `feat(slider): gradient fill range`.
5. **Scaffold radio-group + toggle-group** — `pnpm dlx shadcn@latest add radio-group toggle-group`. Commit `feat(ui): add radio-group and toggle-group primitives`.
6. **`/design-system` gallery** — swatches, type specimen, primitives (button/card/tabs/slider), settings demo (RadioGroup + ToggleGroup), gallery-only body wash. Commit `feat(design-system): add gallery page`.

## Verification
`pnpm lint` · `pnpm build` (TS check) · visit `/design-system`. No unit tests (presentational/token work; gallery is the runnable check).

## Deferred to later phases
- Domain components: `book-cover`, `progress-bar` (Library); `tool-rail`, `chapter-row`, `highlight-card`, `group-header`, `scrubber`, `search-bar` (Reader).
- Warm `.dark` / `.sepia` themes. Promoting body wash to global `<body>`. Refactoring live screens to consume the system.
