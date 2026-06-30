# Auto-Advance Ghost Item

**Date:** 2026-06-30
**Status:** Approved (design dialogue complete) — pending implementation
**Touches:** `audio-provider.tsx`, `audio-context.ts`, `tts-queue.tsx`, reader registration path, tests

---

## Problem

The `autoAdvanceBook` toggle already exists and ships, but its current behavior is the
**inverse** of the intended product vision:

- Today the **manual queue leads** and auto-advance is only a fallback for an *empty*
  queue (`handleSectionComplete`, `audio-provider.tsx:633` — resolves
  `items.find(position === active+1)` first, consults `autoAdvanceBook` only if empty).
- Today the auto-advance branch **persists** the next spine section as a real
  `PlaylistItem` (`addItem({mode:"last"})` + `activateItem`, `:675-689`) — so "automatic"
  segments become indistinguishable from user-curated queue rows.

The intended behavior: when `autoAdvanceBook` is on, the **book's own next readable
segment leads** (pinned on-deck, ahead of the user's manual queue), and it is rendered
as a visually distinct, non-draggable **ghost** so users can tell it apart from items
they curated themselves.

## Goals

- Flip precedence: **ghost leads → manual queue → terminal**, in that order, for every
  advance path (section-complete auto-advance, explicit skip, ghost-click).
- Render the ghost as a dashed/pinned, non-draggable card in the on-deck slot of
  `tts-queue.tsx`, between `active` and the `upcoming` list.
- Ghost is **computed** (a pure function of the active item), not persisted as an
  upcoming row. It is persisted only at the moment it promotes to active, via the
  existing `addItem` + `activateItem` path, after which it is an ordinary item.
- Ghost click behaves identically to the skip button (promote ghost → play).

## Non-goals

- **No retirement/dedup logic.** If a user manually queues a segment that the ghost
  would also produce, both render and both can play (option "c" from the design
  dialogue). Double-play is accepted as "the user queued it." See Deferred.
- No per-book persistence of the toggle — `autoAdvanceBook` stays a single global
  boolean (`/api/playlist/settings`).
- No re-architecture of the playlist data model. `PlaylistItem` gains no new fields.

## Design decisions (resolved in dialogue)

| Decision | Resolution |
|---|---|
| "Readable" definition | Bounded range across the spine: `[readableStartSectionHref, readableEndSectionHref]` (LLM-pinned during expanded metadata extraction; `schema.prisma:190-191`). Sections outside the range are never ghost candidates. |
| Ghost recompute trigger | On **activation** of an item, held while it stays active. Never "at end." The ghost always reflects the next step of whatever is active *right now*. |
| Ghost ⇄ manual-queue collision (display) | **(c) Always show both.** Ghost is rendered whenever eligible, regardless of queue contents — iron-simple, learnable, no flicker. |
| Double-play at advance time | **Lazy: do nothing.** Ghost and manual queue are fully independent; no consume-on-advance rule. |
| Ghost click | Behaves as skip (promote ghost → play). |
| Lower-bound gating | Add `readableStartSectionHref` to `BookAudioContext` + `AudioSession` now (currently only end is tracked). |
| Toggle persistence | Global boolean, unchanged. |

## Architecture

### Approach: virtual ghost

The ghost is a **derived value**, never stored as an upcoming `PlaylistItem`. It exists
only while future/on-deck. The instant it promotes to active it is persisted via the
existing `addItem` + `activateItem` path and becomes an ordinary item (history after it
plays).

Rejected alternative: a persisted row with an `isAuto`/`source` flag. Rejected because
the ghost recomputes on every activation, so a persisted ghost would need constant
delete/recreate churn and would fight the manual queue's position space. Virtual is
cleaner and makes "always show both" (option c) fall out naturally — the ghost and a
manual row targeting the same segment simply coexist as two different things (one
computed, one stored).

### The engine — ghost as a pure function of the active item

```
ghostItem =
  ( autoAdvanceBook
    && session != null
    && activeItem != null
    && activeItem.bookId === session.bookId )
    ? computeGhost(activeItem, session)
    : null

computeGhost(active, session):
  activeIdx = session.flatToc.indexOf(active.sectionHref)
  startIdx  = session.readableStartSectionHref
               ? session.flatToc.indexOf(readableStartSectionHref)
               : 0
  endIdx    = session.readableEndSectionHref
               ? session.flatToc.indexOf(readableEndSectionHref)
               : session.flatToc.length - 1
  // First readable section strictly after the active section, within [start, end].
  ghostIdx  = (activeIdx < startIdx) ? startIdx : activeIdx + 1
  return (ghostIdx >= 0 && startIdx <= ghostIdx <= endIdx && ghostIdx < flatToc.length)
         ? { sectionHref: flatToc[ghostIdx].href,
             sectionLabel: flatToc[ghostIdx].label }
         : null
```

Computed once (memoized in the provider from `session` + `activeItem` + bounds), exposed
on `AudioContextValue` as `ghostItem: { sectionHref, sectionLabel } | null`. **Single
source of truth** — consumed by both the advance logic and the UI.

### Precedence flip in the advance path

All advance entry points (`handleSectionComplete`, `advanceToNextSection`, ghost-click)
resolve next-item in this order:

1. **Ghost eligible** (`ghostItem != null`) → promote: `addItem` + `activateItem` +
   `startSection`. Return.
2. **Manual next** (`position === active.position + 1`) exists → `activateItem` +
   `startSection`. Return.
3. **Terminal** (active is readable-end, or end of flat-toc) and no manual next →
   `markBookFinished` (for `handleSectionComplete`) / no-op (for explicit click).
4. Else idle.

Toggle-off skips straight to step 2 — matching the documented toggle-off behavior.

The current distinction between `handleSectionComplete` (auto-advance-guarded) and
`advanceToNextSection` (explicit, unguarded) collapses: with the ghost model, both go
ghost-first when the toggle is on. When the toggle is off there is no ghost, so both
fall to manual-next; the only remaining difference is the terminal behavior
(mark-finished vs no-op). The implementation plan should extract a shared
`resolveNext()` used by all three entry points.

### Skip-button visibility

`canSkipAhead` simplifies from the current `hasNextUpcoming || hasSpineNext` (which
ignores readable bounds) to:

```
canSkipAhead = playbackState.state !== "IDLE" && (ghostItem != null || hasNextUpcoming)
```

### UI — ghost slot in `tts-queue.tsx`

Render a dashed, non-draggable ghost card **pinned between `active` and the `upcoming`
list** when `ghostItem` is non-null:

- Exclude `ghostItem` from `upcomingIds` (the DnD sort list) — it can neither be dragged
  nor dragged past.
- `onDeckCount` becomes `(active ? 1 : 0) + (ghost ? 1 : 0) + upcoming.length`.
- Click handler invokes the same advance path as the skip button (promote ghost).
- Visual treatment: dashed border / muted styling to signal "setting-generated, not
  curated."

## Edge cases

| Case | Behavior |
|---|---|
| Toggle off | No ghost; manual queue leads (step 2). |
| Active is last readable section | `ghostItem` null; manual queue leads. |
| Active is in front matter (before `readableStart`) | Ghost = `readableStartSectionHref` (first readable segment). |
| Active isn't a book segment / no session | `ghostItem` null; toggle inert for that item. |
| Toggle flipped mid-playback | Ghost appears/vanishes instantly (pure function of active + toggle). |
| Manual queue holds same segment as ghost | Both render (option c); no retirement; double-play accepted. |
| Ghost clicked | Promotes ghost (same as skip). |
| No active item (bookshelf / browsing) | No ghost (ghost derives from the active *playlist* item, not the open book). |

## Scope of code changes

1. **`audio-context.ts`** — add `ghostItem: { sectionHref; sectionLabel } | null` to
   `AudioContextValue`; add `readableStartSectionHref` to `BookAudioContext` and
   `AudioSession`.
2. **`audio-provider.tsx`** —
   - Thread `readableStartSectionHref` into the session in `registerBook`.
   - Memoize `ghostItem` from `session` + `activeItem` + bounds.
   - Extract shared `resolveNext()`; rewrite `handleSectionComplete` and
     `advanceToNextSection` to ghost-first precedence.
   - Simplify `canSkipAhead` to `ghostItem != null || hasNextUpcoming`.
   - Wire ghost-click to the same advance path as skip.
   - Add `ghostItem` to the context value.
3. **Reader registration path** — `reader-client.tsx` already has
   `readableStartSectionHref`; ensure the `registerBook(ctx)` call site includes it in
   `BookAudioContext`.
4. **`tts-queue.tsx`** — render the pinned dashed ghost slot between `active` and
   `upcoming`; exclude from DnD; wire click to advance.
5. **Tests** —
   - `handleSectionComplete` / `resolveNext`: ghost-leads, manual-fallback, terminal,
     toggle-off, active-in-front-matter.
   - `computeGhost`: all null cases (no session, non-book active, exhausted, toggle off).
   - `tts-queue`: ghost slot renders when eligible, dashed, excluded from DnD, click
     advances.
   - Update existing tests that assume manual-leads precedence.

No schema changes — `readableStartSectionHref` already exists on `BookMetadata`
(`schema.prisma:190`). No prisma regenerate or dev-server restart required for that
reason (though the audio-provider changes warrant a normal dev restart to be safe).

## Deferred / out of scope

- **Notify/confirm when user toggles on AND has queued content the ghost will also
  produce** — parked as a separate ticket. The lazy double-play rule holds until then.
- Per-book toggle persistence.
- Visual treatment beyond dashed border (e.g., distinct icon, "auto" label) — defer to
  the implementation pass and design review.
