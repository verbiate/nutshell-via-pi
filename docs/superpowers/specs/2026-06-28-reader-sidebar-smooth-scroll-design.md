# Reader Sidebar Smooth Scroll — Design

**Date:** 2026-06-28
**Status:** Awaiting sign-off
**Scope:** Bring the Bookshelf's `SmoothScrollArea` (Lenis momentum smoothing + fade-in custom scrollbar thumb) into the reader side nav so every scrollable surface in the sidebar matches the bookshelf feel.

## Goal

The reader's side-nav panels currently use shadcn `ScrollArea` (a Radix native-scroll wrapper with an always-visible scrollbar) or a plain `overflow-y-auto` div. The Bookshelf has a smoother scroll treatment — `SmoothScrollArea` (`src/components/library/smooth-scroll-area.tsx`) — that adds Lenis momentum smoothing and a semi-transparent, fade-in drag-to-scroll thumb. Apply that treatment to every scrollable surface in the reader sidebar so the reading scene's panels feel consistent with the shelf scene.

## User stories

1. As a reader scrolling the Contents / Bookmarks / Notes + Highlights / Book Settings panels in the sidebar, the scroll glides with momentum and shows a slim, fade-in thumb that hides itself when idle — matching the bookshelf.
2. As a reader scrolling the Discussions list view (the list of past discussions for the open book), the same smooth-scroll + fade-in thumb applies.
3. As a reader on a touch device or with reduced-motion preference, I get plain native scroll with no Lenis involvement (existing `SmoothScrollArea` behavior — preserved, not re-implemented).

## Non-goals (Phase 2 / YAGNI)

- **Discussions message-stream container.** The in-discussion message stream (`discussions-panel.tsx:1773`, the `scrollRef` div that auto-scrolls to the bottom on every streamed chunk) is **not** wrapped in this phase. Its auto-scroll behavior interacts with Lenis's internal animated-scroll state and needs a dedicated seam (imperative `scrollTo` on `SmoothScrollArea`, or a swap to `lenis.scrollTo` at the call site). That work is Phase 2.
- **Moving `SmoothScrollArea` out of `components/library/`.** Cross-folder import works; relocating is unrelated churn. Flagged for a later cleanup.
- **Changing `SmoothScrollArea` itself.** Zero edits to the component, its tests, `scrollbar-math.ts`, or the `.smooth-scroll-area` CSS rules in `globals.css`.
- **Mobile / narrow viewport behavior.** Reader sidebar is `hidden sm:flex`, so the 640–1023px range shows no sidebar at all. `SmoothScrollArea`'s existing `<1024px → passthrough` and `reduced-motion → native scroll` fallbacks apply unchanged on `≥1024px` reduced-motion users.

## Decisions (resolved)

| Axis | Decision | Why |
|---|---|---|
| Phase 1 surfaces | 4 list-shaped panels + Discussions list view; message stream deferred | User chose "every scrollable surface" for Phase 1, then narrowed the message-stream wrap to Phase 2 to avoid the Lenis-vs-auto-scroll seam in this pass |
| Component swap | Replace `ScrollArea` (shadcn/Radix) and the bare `overflow-y-auto` list div with `SmoothScrollArea` | The whole point — one component already encapsulates Lenis + custom thumb + fallbacks |
| `SmoothScrollArea` API | No changes | No imperative scroll needed in Phase 1 — the only auto-scroll site is the deferred message stream |
| File location | Leave in `components/library/` | Move is unrelated churn; `reader → library` import direction is acceptable |
| Tests | Update existing assertions that target `ScrollArea` / `overflow-y-auto` list div; add one minimal assertion that the Discussions list renders inside `data-smooth-scroll-root` | Catch the swap; don't rebuild the wheel |

## Changes

### `src/components/reader/reader-sidebar.tsx`

- Import `SmoothScrollArea` from `@/components/library/smooth-scroll-area`.
- Swap the `<ScrollArea className="min-h-0 flex-1">…</ScrollArea>` block (currently lines 128–133) for `<SmoothScrollArea className="min-h-0 flex-1"><div className="pb-12">{panels[tool.id]}</div></SmoothScrollArea>`. The `pb-12` trailing margin and the inner panel content stay unchanged.
- Remove the now-unused `ScrollArea` import from `@/components/ui/scroll-area`.
- The bulb (Discussions) special-case (lines 116–126) stays untouched — `DiscussionsPanel` owns its internal scroll wrapping, including the list-view change below.

### `src/components/discussion/discussions-panel.tsx`

- Import `SmoothScrollArea` from `@/components/library/smooth-scroll-area`.
- At the list-view container (currently line 1400, `<div className="flex-1 min-h-0 overflow-y-auto py-2">…</div>`), replace with `<SmoothScrollArea className="flex-1 min-h-0"><div className="py-2">…</div></SmoothScrollArea>`. The `overflow-y-auto` is owned by `SmoothScrollArea`'s viewport; `py-2` stays on the inner content div.
- The in-discussion message stream (line 1773, `<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">`) is **untouched** in this phase.

## What stays the same

- `SmoothScrollArea` component, `scrollbar-math.ts`, `globals.css` `.smooth-scroll-area` rules — no edits.
- Desktop/mobile/reduced-motion gating — `SmoothScrollArea` handles all three; reader sidebar is `hidden sm:flex` so the 640–1023px range shows no sidebar, and ≥1024px reduced-motion users get the existing native-scroll fallback.
- At most one `SmoothScrollArea` is mounted in the sidebar at a time — `displayedTool` is a single value (not dual-rendered), and the bulb panel's list view and the other panels are mutually exclusive by tool selection.
- The pop-out Dialog for Discussions renders `DiscussionsPanel` again inside the modal; the list view (if shown there) gets `SmoothScrollArea` in that context too. Same component, two mount sites, both fine.

## Testing

- `src/components/library/__tests__/smooth-scroll-area.test.tsx` — unchanged, stays green (component untouched).
- `src/components/reader/__tests__/tts-player.test.tsx:41` — mocks `ScrollArea` as a passthrough. Unrelated to the sidebar swap (TTS player isn't the sidebar); leave it alone.
- No existing test directly asserts on the sidebar's `ScrollArea` or the Discussions list's `overflow-y-auto` div. Verify by re-grepping after the swap.
- New minimal check (in a new `reader-sidebar.test.tsx` or the closest existing reader test): render the sidebar with a known tool active and assert the scroll container has `data-smooth-scroll-root` (the outer wrapper `SmoothScrollArea` renders).
- New minimal check in `discussions-home.test.tsx` or a new `discussions-panel-list.test.tsx`: render the Discussions list view and assert `data-smooth-scroll-root` is present.

## Visual effect

The reader sidebar panels gain Lenis momentum smoothing + the semi-transparent (`bg-ink/30`) fade-in drag-to-scroll thumb, replacing shadcn's always-visible Radix scrollbar. The thumb fades in on scroll / hover / drag and fades out after 1s idle (existing `SmoothScrollArea` behavior). This matches the Bookshelf tab's scroll feel exactly — the intended consistency win.

## Phase 2 preview (not in this spec)

Wrap the Discussions message-stream container (`discussions-panel.tsx:1773`) in `SmoothScrollArea`, then route the existing `el.scrollTop = el.scrollHeight` auto-scroll (line 1649) through an imperative `scrollTo` on `SmoothScrollArea` (via `forwardRef` + `useImperativeHandle`) so it delegates to `lenis.scrollTo`. Phase 2's open question — whether the catch-up glides (`immediate: false`) or stays instant (`immediate: true`) — is decided in that spec.
