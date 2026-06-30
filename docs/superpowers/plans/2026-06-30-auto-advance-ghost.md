# Auto-Advance Ghost Item — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip `autoAdvanceBook` from manual-first/auto-fallback to ghost-first precedence, where the book's next readable segment is rendered as a pinned, non-draggable dashed "ghost" card on-deck ahead of the manual queue, computed live from the active item.

**Architecture:** A pure decision module (`src/lib/reader/ghost.ts`) holds the testable core: `ghostOffset` (index math), `resolveGhostItem` (href→index resolution + flatToc lookup), and `resolveAdvance` (ghost → manual → terminal → idle precedence). The audio provider memoizes `ghostItem` from the session, exposes it on context, and rewrites both advance entry points (`handleSectionComplete`, `advanceToNextSection`) to delegate to `resolveAdvance`. `tts-queue.tsx` renders the ghost as a prop-driven dashed card between `active` and `upcoming`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript 6, Vitest 4, `@dnd-kit/sortable`, shadcn/ui. No Prisma changes.

## Global Constraints

- **No Prisma/schema changes.** `readableStartSectionHref` already exists on `BookMetadata` (`schema.prisma:190`). No `db:generate`/restart needed for that reason.
- **Commits are gated on user sign-off** per house rules. Each task ends with a commit step; the operator pauses and asks the user before running `git commit` (the user may batch). Do not auto-commit.
- **No comments** unless asked — except `ponytail:` markers for deliberate simplifications, matching the file's existing convention.
- **No new dependencies.**
- Typecheck command: `npx tsc --noEmit`. Test command: `npx vitest run`. Single-test: `npx vitest run <path>`.
- **Behavior change to flag:** toggle-OFF explicit skip no longer advances into the next spine section (the ghost is now the *only* spine-advance mechanism, and it requires the toggle on). This unifies the model; old toggle-off explicit-spine-advance is intentionally removed.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/reader/ghost.ts` (NEW) | Pure advance-decision logic: `ghostOffset`, `resolveGhostItem`, `resolveAdvance` + `AdvanceDecision` type | Create |
| `src/lib/reader/__tests__/ghost.test.ts` (NEW) | Unit tests for all three pure functions | Create |
| `src/components/audio/audio-context.ts` | Type surface: `BookAudioContext`, `AudioSession`, `AudioContextValue` | Modify |
| `src/components/audio/audio-provider.tsx` | `createSession`, `ghostItem` memo, advance rewrite, `canSkipAhead`, context value, `ghostItemRef` | Modify |
| `src/components/reader/reader-client.tsx` | `registerBook` call: pass `readableStartSectionHref` | Modify |
| `src/components/reader/tts-queue.tsx` | Ghost card render + props + DnD exclusion | Modify |
| `src/components/reader/tts-player.tsx` | Thread `ghostItem` prop to `TtsQueue`, bind ghost-click to `onSkipNext` | Modify |
| `src/components/reader/__tests__/tts-queue.test.tsx` | Ghost render tests | Modify |

---

## Task 1: Pure advance-decision module

**Files:**
- Create: `src/lib/reader/ghost.ts`
- Test: `src/lib/reader/__tests__/ghost.test.ts`

**Interfaces:**
- Produces: `ghostOffset(currentIndex, startIndex, endIndex, len) => number | null`; `resolveGhostItem(flatToc, currentIndex, startHref, endHref, matchFn) => { sectionHref, sectionLabel } | null`; `resolveAdvance(opts) => AdvanceDecision`; type `AdvanceDecision`; type `GhostItem = { sectionHref: string; sectionLabel: string }`.
- Consumes: `FlatSection` from `@/lib/reader/spine-playlist`; `PlaylistItem` from `@/types/playlist`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reader/__tests__/ghost.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ghostOffset,
  resolveGhostItem,
  resolveAdvance,
} from "../ghost";
import type { FlatSection } from "@/lib/reader/spine-playlist";
import type { PlaylistItem } from "@/types/playlist";

const toc = (n: number): FlatSection[] =>
  Array.from({ length: n }, (_, i) => ({
    href: `ch${i}.xhtml`,
    label: `Ch ${i}`,
    index: i,
  }));

const exact = (a: string, b: string) => a === b;

function mkItem(over: Partial<PlaylistItem>): PlaylistItem {
  return {
    id: "x", userId: "u", bookId: "b", sectionHref: "ch0.xhtml",
    sectionLabel: "Ch 0", position: 0, status: "upcoming",
    bookTitle: null, bookAuthor: null, bookCoverPath: null,
    bookLanguage: "en", addedAt: "", playedAt: null, ...over,
  };
}

describe("ghostOffset", () => {
  it("returns currentIndex+1 when within bounds", () => {
    expect(ghostOffset(2, 0, 4, 5)).toBe(3);
  });
  it("clamps up to startIndex when active is in front matter", () => {
    expect(ghostOffset(0, 2, 4, 5)).toBe(2);
  });
  it("returns null at the last readable section (exhausted)", () => {
    expect(ghostOffset(4, 0, 4, 5)).toBeNull();
  });
  it("returns null past the readable end", () => {
    expect(ghostOffset(5, 0, 4, 5)).toBeNull();
  });
  it("returns null when window is invalid (start > end)", () => {
    expect(ghostOffset(2, 4, 1, 5)).toBeNull();
  });
  it("treats full spine as window when start=0 end=len-1", () => {
    expect(ghostOffset(0, 0, 4, 5)).toBe(1);
  });
});

describe("resolveGhostItem", () => {
  it("resolves next section href+label within the readable window", () => {
    const g = resolveGhostItem(toc(5), 1, "ch0.xhtml", "ch4.xhtml", exact);
    expect(g).toEqual({ sectionHref: "ch2.xhtml", sectionLabel: "Ch 2" });
  });
  it("jumps to readable start when active is in front matter", () => {
    const g = resolveGhostItem(toc(5), 0, "ch2.xhtml", "ch4.xhtml", exact);
    expect(g?.sectionHref).toBe("ch2.xhtml");
  });
  it("returns null when active is the readable end", () => {
    const g = resolveGhostItem(toc(5), 4, "ch0.xhtml", "ch4.xhtml", exact);
    expect(g).toBeNull();
  });
  it("returns null when readable hrefs are absent from flatToc", () => {
    const g = resolveGhostItem(toc(5), 1, "ch0.xhtml", "missing.xhtml", exact);
    expect(g).toBeNull();
  });
  it("uses the whole spine when bounds are null", () => {
    const g = resolveGhostItem(toc(5), 3, null, null, exact);
    expect(g?.sectionHref).toBe("ch4.xhtml");
  });
});

describe("resolveAdvance", () => {
  const ghost = { sectionHref: "ch2.xhtml", sectionLabel: "Ch 2" };
  const manual = mkItem({ id: "m1" });

  it("ghost leads when present", () => {
    expect(
      resolveAdvance({
        ghostItem: ghost,
        manualNext: manual,
        atReadableEnd: false,
        atEndOfToc: false,
      }),
    ).toEqual({ kind: "ghost" });
  });
  it("manual leads when ghost absent", () => {
    expect(
      resolveAdvance({
        ghostItem: null,
        manualNext: manual,
        atReadableEnd: false,
        atEndOfToc: false,
      }),
    ).toEqual({ kind: "manual", item: manual });
  });
  it("terminal when at readable end and nothing else", () => {
    expect(
      resolveAdvance({
        ghostItem: null,
        manualNext: null,
        atReadableEnd: true,
        atEndOfToc: false,
      }),
    ).toEqual({ kind: "terminal" });
  });
  it("terminal at end of flat toc", () => {
    expect(
      resolveAdvance({
        ghostItem: null,
        manualNext: null,
        atReadableEnd: false,
        atEndOfToc: true,
      }),
    ).toEqual({ kind: "terminal" });
  });
  it("idle when nothing to do", () => {
    expect(
      resolveAdvance({
        ghostItem: null,
        manualNext: null,
        atReadableEnd: false,
        atEndOfToc: false,
      }),
    ).toEqual({ kind: "idle" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/reader/__tests__/ghost.test.ts`
Expected: FAIL — module `../ghost` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/lib/reader/ghost.ts`:

```ts
import type { FlatSection } from "@/lib/reader/spine-playlist";
import type { PlaylistItem } from "@/types/playlist";

export type GhostItem = { sectionHref: string; sectionLabel: string };

export type AdvanceDecision =
  | { kind: "ghost" }
  | { kind: "manual"; item: PlaylistItem }
  | { kind: "terminal" }
  | { kind: "idle" };

/**
 * Index of the first readable spine section strictly after `currentIndex`,
 * within the readable window [startIndex, endIndex]. Null when the active
 * section is at or past the readable end (ghost exhausted), or the window is
 * invalid. When `currentIndex` falls before the window (front matter), the
 * ghost is the window start.
 */
export function ghostOffset(
  currentIndex: number,
  startIndex: number,
  endIndex: number,
  len: number,
): number | null {
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) return null;
  const ghostIdx = Math.max(currentIndex + 1, startIndex);
  if (ghostIdx > endIndex || ghostIdx >= len || ghostIdx < 0) return null;
  return ghostIdx;
}

/**
 * Resolve the ghost to a concrete {href, label} by locating the readable
 * bounds in `flatToc` via `matchFn` (basename-aware compare). Null bounds
 * mean "no pin" → the whole spine is the window.
 */
export function resolveGhostItem(
  flatToc: FlatSection[],
  currentIndex: number,
  startHref: string | null,
  endHref: string | null,
  matchFn: (a: string, b: string) => boolean,
): GhostItem | null {
  const len = flatToc.length;
  if (len === 0) return null;
  const startIndex = startHref
    ? flatToc.findIndex((s) => matchFn(s.href, startHref))
    : 0;
  const endIndex = endHref
    ? flatToc.findIndex((s) => matchFn(s.href, endHref))
    : len - 1;
  const off = ghostOffset(currentIndex, startIndex, endIndex, len);
  if (off == null) return null;
  const s = flatToc[off];
  return { sectionHref: s.href, sectionLabel: s.label };
}

/**
 * Precedence: ghost → manual next → terminal → idle. Pure; callers perform
 * the side effects (promote ghost / activate item / mark finished / no-op).
 */
export function resolveAdvance(opts: {
  ghostItem: GhostItem | null;
  manualNext: PlaylistItem | null;
  atReadableEnd: boolean;
  atEndOfToc: boolean;
}): AdvanceDecision {
  if (opts.ghostItem) return { kind: "ghost" };
  if (opts.manualNext) return { kind: "manual", item: opts.manualNext };
  if (opts.atReadableEnd || opts.atEndOfToc) return { kind: "terminal" };
  return { kind: "idle" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/reader/__tests__/ghost.test.ts`
Expected: PASS (all 16 cases).

- [ ] **Step 5: Commit (on user sign-off)**

```bash
git add src/lib/reader/ghost.ts src/lib/reader/__tests__/ghost.test.ts
git commit -m "feat(audio): add pure ghost/advance decision module"
```

---

## Task 2: Thread readableStartSectionHref through the session

**Files:**
- Modify: `src/components/audio/audio-context.ts:14-40`
- Modify: `src/components/audio/audio-provider.tsx:76-91` (`createSession`)
- Modify: `src/components/reader/reader-client.tsx:1197-1227` (`registerBook` call + deps)

**Interfaces:**
- Produces: `BookAudioContext.readableStartSectionHref`, `AudioSession.readableStartSectionHref` (both `string | null | undefined`).
- Consumes: nothing from later tasks; this is plumbing that Task 3 relies on.

- [ ] **Step 1: Add the fields to the context types**

In `src/components/audio/audio-context.ts`, add `readableStartSectionHref` to `BookAudioContext` (after the existing `readableEndSectionHref` at line 26) and to `AudioSession` (after line 39). Both optional:

```ts
// In BookAudioContext (after readableEndSectionHref):
  // ponytail: LLM-pinned first readable section href. The ghost jumps here
  // when the active item is in front matter (before the readable window).
  readableStartSectionHref?: string | null;

// In AudioSession (after readableEndSectionHref):
  // ponytail: null when no metadata row or no start anchor pinned.
  readableStartSectionHref?: string | null;
```

Also add `ghostItem` to `AudioContextValue` (after `activeItemId` at line 142):

```ts
  /** Computed next readable segment of the active item's book, when
   *  autoAdvanceBook is on and a next readable segment exists. Ephemeral —
   *  not a persisted PlaylistItem until it promotes to active. */
  ghostItem: { sectionHref: string; sectionLabel: string } | null;
```

- [ ] **Step 2: Copy the field in createSession**

In `src/components/audio/audio-provider.tsx`, `createSession` (line 76-91), add the start field next to the end field:

```ts
    currentIndex,
    readableEndSectionHref: ctx.readableEndSectionHref,
    readableStartSectionHref: ctx.readableStartSectionHref,
  };
```

- [ ] **Step 3: Pass it from the reader's registerBook call**

In `src/components/reader/reader-client.tsx` (line 1197-1208), add `readableStartSectionHref` to the `registerBook({...})` object, and add it to the effect's dep array.

```ts
    registerBook({
      bookId,
      bookTitle,
      bookAuthor,
      bookCoverPath,
      bookLanguage: bookLanguage ?? "en",
      toc,
      spineItems,
      userRole,
      currentHref,
      readableEndSectionHref: endSectionHref,
      readableStartSectionHref: startSectionHref,
    });
```

And in the deps array (line 1213-1227), add `readableStartSectionHref` next to the existing `readableEndSectionHref`:

```ts
    currentHref,
    readableEndSectionHref,
    readableStartSectionHref,
  ]);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (`ghostItem` on `AudioContextValue` is not yet supplied by the provider — Task 3 adds it. If tsc errors on the missing `ghostItem` in the context value object, defer re-running until after Task 3 Step 2; the type is intentionally declared ahead here.)

- [ ] **Step 5: Commit (on user sign-off)**

```bash
git add src/components/audio/audio-context.ts src/components/audio/audio-provider.tsx src/components/reader/reader-client.tsx
git commit -m "feat(audio): thread readableStartSectionHref into the audio session"
```

---

## Task 3: Compute ghostItem in the provider and expose on context

**Files:**
- Modify: `src/components/audio/audio-provider.tsx` (imports, `ghostItem` memo + ref, `canSkipAhead`, context value object)
- Test: covered by Task 1's `resolveGhostItem` tests (the provider is thin wiring over the pure function).

**Interfaces:**
- Consumes: `resolveGhostItem` from `@/lib/reader/ghost`.
- Produces: `ghostItem` on `AudioContextValue`; `ghostItemRef` for the advance handlers (Task 4).

- [ ] **Step 1: Import the pure module**

At the top of `src/components/audio/audio-provider.tsx`, alongside the existing `buildSpinePlaylist` import (line 16):

```ts
import { resolveGhostItem, type GhostItem } from "@/lib/reader/ghost";
```

- [ ] **Step 2: Add the ghostItem memo + ref**

Just below the existing `autoAdvanceRef` sync effect (around line 347), add a ref sync. And near the `canSkipAhead` computation (line 1282), add the memo. Place the memo before `canSkipAhead`:

```ts
  // ponytail: ghost = next readable section of the active item's book.
  // Pure function of (session + active item + toggle); recomputed on every
  // activation, held while active. Null when toggle off, no session, the
  // active item belongs to another book, or the readable window is exhausted.
  const ghostItem: GhostItem | null = useMemo(() => {
    if (!autoAdvanceBook || !session || !activeItem) return null;
    if (activeItem.bookId !== session.bookId) return null;
    return resolveGhostItem(
      session.flatToc,
      session.currentIndex,
      session.readableStartSectionHref ?? null,
      session.readableEndSectionHref ?? null,
      ttsSectionMatches,
    );
  }, [autoAdvanceBook, session, activeItem]);

  const ghostItemRef = useRef(ghostItem);
  useEffect(() => {
    ghostItemRef.current = ghostItem;
  }, [ghostItem]);
```

- [ ] **Step 3: Simplify canSkipAhead**

Replace the `hasSpineNext` + `canSkipAhead` block (lines 1286-1288):

```ts
  const canSkipAhead =
    playbackState.state !== "IDLE" && (ghostItem != null || hasNextUpcoming);
```

(Delete the `hasSpineNext` line entirely — it is subsumed by `ghostItem`.)

- [ ] **Step 4: Add ghostItem to the context value**

In the `useMemo` context value object (around line 1320, near `activeItemId`), add:

```ts
      activeItemId: activeItem?.id ?? null,
      ghostItem,
      playSection,
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. The `ghostItem` declared on `AudioContextValue` in Task 2 is now supplied.

- [ ] **Step 6: Commit (on user sign-off)**

```bash
git add src/components/audio/audio-provider.tsx
git commit -m "feat(audio): compute ghostItem and expose on audio context"
```

---

## Task 4: Flip advance precedence to ghost-first

**Files:**
- Modify: `src/components/audio/audio-provider.tsx` — `handleSectionComplete` (633-690), `advanceToNextSection` (697-724)
- Test: covered by Task 1's `resolveAdvance` tests; precedence is now pure.

**Interfaces:**
- Consumes: `resolveAdvance` from `@/lib/reader/ghost`; `ghostItemRef` from Task 3.

- [ ] **Step 1: Rewrite handleSectionComplete**

Replace the body of `handleSectionComplete` (lines 633-690) with a `resolveAdvance`-driven version. Keep the `markBookFinished` dependency. Add `resolveAdvance` to the import from Task 3 Step 1:

```ts
import { resolveGhostItem, resolveAdvance, type GhostItem } from "@/lib/reader/ghost";
```

New body:

```ts
  const handleSectionComplete = useCallback(async () => {
    const s = sessionRef.current;
    const active = activeItemRef.current;
    if (!s || !active) return;

    const manualNext =
      playlistItemsRef.current.find(
        (i) => i.position === active.position + 1,
      ) ?? null;
    const atReadableEnd =
      !!s.readableEndSectionHref &&
      ttsSectionMatches(active.sectionHref, s.readableEndSectionHref);
    const atEndOfToc = s.currentIndex + 1 >= s.flatToc.length;

    const decision = resolveAdvance({
      ghostItem: ghostItemRef.current,
      manualNext,
      atReadableEnd,
      atEndOfToc,
    });

    switch (decision.kind) {
      case "ghost": {
        const g = ghostItemRef.current;
        if (!g) return;
        const item = await playlistMutations.addItem({
          bookId: s.bookId,
          sectionHref: g.sectionHref,
          sectionLabel: g.sectionLabel,
          mode: "last",
          bookTitle: s.bookTitle,
          bookAuthor: s.bookAuthor,
          bookCoverPath: s.bookCoverPath,
          bookLanguage: s.bookLanguage,
        });
        await playlistMutations.activateItem(item.id);
        startSection(g.sectionHref, g.sectionLabel);
        return;
      }
      case "manual": {
        await playlistMutations.activateItem(decision.item.id);
        startSection(decision.item.sectionHref, decision.item.sectionLabel);
        return;
      }
      case "terminal": {
        markBookFinished(s);
        return;
      }
      case "idle":
        return;
    }
  }, [markBookFinished, playlistMutations, startSection]);
```

- [ ] **Step 2: Rewrite advanceToNextSection**

Replace `advanceToNextSection` (lines 697-724). Same decision logic; the only difference is `terminal` → no-op (explicit click does not raise "Book finished"):

```ts
  // ponytail: explicit "next" intent — skip button OR ghost-click OR ENDED-card
  // tap. Same ghost-first precedence as handleSectionComplete; terminal is a
  // no-op here rather than markBookFinished (the click is user-driven).
  const advanceToNextSection = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    const active = activeItemRef.current;

    const manualNext = active
      ? (playlistItemsRef.current.find(
          (i) => i.position === active.position + 1,
        ) ?? null)
      : null;
    const atReadableEnd =
      !!active &&
      !!s.readableEndSectionHref &&
      ttsSectionMatches(active.sectionHref, s.readableEndSectionHref);
    const atEndOfToc = s.currentIndex + 1 >= s.flatToc.length;

    const decision = resolveAdvance({
      ghostItem: ghostItemRef.current,
      manualNext,
      atReadableEnd,
      atEndOfToc,
    });

    switch (decision.kind) {
      case "ghost": {
        const g = ghostItemRef.current;
        if (!g) return;
        const item = await playlistMutations.addItem({
          bookId: s.bookId,
          sectionHref: g.sectionHref,
          sectionLabel: g.sectionLabel,
          mode: "last",
          bookTitle: s.bookTitle,
          bookAuthor: s.bookAuthor,
          bookCoverPath: s.bookCoverPath,
          bookLanguage: s.bookLanguage,
        });
        await playlistMutations.activateItem(item.id);
        startSection(g.sectionHref, g.sectionLabel);
        return;
      }
      case "manual": {
        await playlistMutations.activateItem(decision.item.id);
        startSection(decision.item.sectionHref, decision.item.sectionLabel);
        return;
      }
      case "terminal":
        return;
      case "idle":
        return;
    }
  }, [playlistMutations, startSection]);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS. (No existing test asserts the old manual-first precedence directly — `tts-queue`/`tts-player` tests are prop-driven and don't exercise the provider's handlers. If any test fails, it indicates an assumption worth investigating before proceeding.)

- [ ] **Step 5: Commit (on user sign-off)**

```bash
git add src/components/audio/audio-provider.tsx
git commit -m "feat(audio): flip advance precedence to ghost-first"
```

---

## Task 5: Render the ghost card in the queue UI

**Files:**
- Modify: `src/components/reader/tts-queue.tsx` (props, ghost card, onDeckCount, DnD exclusion)
- Modify: `src/components/reader/tts-player.tsx` (thread `ghostItem` prop, bind ghost-click to `onSkipNext`)
- Modify: `src/components/audio/audio-provider.tsx` (pass `ghostItem` to `TtsPlayer`)
- Test: `src/components/reader/__tests__/tts-queue.test.tsx`

**Interfaces:**
- `TtsQueueProps` gains: `ghostItem?: GhostItem | null`; `onPlayGhost?: () => void`.
- `TtsPlayerProps` gains: `ghostItem?: GhostItem | null`.

- [ ] **Step 1: Write the failing UI tests**

Append to `src/components/reader/__tests__/tts-queue.test.tsx` (the mocks already pass `ghostItem`/`onPlayGhost` through `baseProps` once added — update `baseProps` first):

Update `baseProps` (line 94) to include the two new optional props:

```ts
const baseProps = {
  activeItemId: null,
  autoAdvanceBook: true,
  ghostItem: null,
  onPlayGhost: noop,
  onReorder: noop,
  onRemove: noop,
  onClearAll: noop,
  onClearUpcoming: noop,
  onToggleAutoAdvance: noop,
  onJumpToItem: noop,
  open: true,
  onOpenChange: noop,
};
```

Add a new describe block at the end of the file:

```ts
import type { GhostItem } from "@/lib/reader/ghost";

describe("TtsQueue: ghost card", () => {
  const ghost: GhostItem = { sectionHref: "ch2.xhtml", sectionLabel: "Chapter 2" };
  const active = mkItem({ id: "a1", status: "active", position: 0 });

  it("renders nothing ghost-related when ghostItem is null", () => {
    const html = render(
      <TtsQueue items={[active]} {...baseProps} ghostItem={null} />,
    );
    expect(html).not.toContain("Up next");
    expect(html).not.toContain("data-ghost");
  });

  it("renders the ghost section label between active and upcoming", () => {
    const html = render(
      <TtsQueue items={[active]} {...baseProps} ghostItem={ghost} />,
    );
    expect(html).toContain("Chapter 2");
    expect(html).toContain("data-ghost");
  });

  it("counts the ghost in the on-deck total", () => {
    const upcoming = mkItem({
      id: "u1", status: "upcoming", position: 1, sectionLabel: "Later",
    });
    const html = render(
      <TtsQueue items={[active, upcoming]} {...baseProps} ghostItem={ghost} />,
    );
    // active(1) + ghost(1) + upcoming(1) = 3
    expect(html).toContain(">3<");
  });

  it("renders the ghost even when a manual upcoming item exists (option c)", () => {
    const upcoming = mkItem({
      id: "u1", status: "upcoming", position: 1, sectionLabel: "Chapter 2",
    });
    const html = render(
      <TtsQueue items={[active, upcoming]} {...baseProps} ghostItem={ghost} />,
    );
    // Both the dashed ghost and the solid manual row carry the label.
    expect(html.match(/Chapter 2/g)?.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/reader/__tests__/tts-queue.test.tsx`
Expected: FAIL — `ghostItem`/`onPlayGhost` not in props; `data-ghost` absent.

- [ ] **Step 3: Add ghost props to TtsQueueProps and render the card**

In `src/components/reader/tts-queue.tsx`:

Add the import (top, after the PlaylistItem import, line 39):

```ts
import type { GhostItem } from "@/lib/reader/ghost";
```

Extend `TtsQueueProps` (line 41) with two optional fields:

```ts
  ghostItem?: GhostItem | null;
  onPlayGhost?: () => void;
```

Destructure them in the component signature (line 198):

```ts
  ghostItem,
  onPlayGhost,
  onClearUpcoming,
```

Update `onDeckCount` (line 206):

```ts
  const onDeckCount =
    (active ? 1 : 0) + (ghostItem ? 1 : 0) + upcoming.length;
```

Add the ghost card render **between** the "Now playing" block (ends ~line 336) and the "Up next" block (starts ~line 339). Insert:

```tsx
              {/* Auto-advance ghost — computed next readable segment.
                  Pinned on-deck, non-draggable; clicking it behaves as skip. */}
              {ghostItem && (
                <div className={cn(active && "mt-4")}>
                  <SectionLabel>Up next</SectionLabel>
                  <ul className="space-y-1">
                    <li
                      data-ghost
                      className="group flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
                    >
                      <Volume2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      <button
                        type="button"
                        onClick={onPlayGhost}
                        className="flex-1 text-left min-w-0"
                      >
                        <span className="block line-clamp-2 leading-snug">
                          {ghostItem.sectionLabel || "Untitled section"}
                        </span>
                      </button>
                    </li>
                  </ul>
                </div>
              )}
```

Then **gate the existing "Up next" header** so it only shows when there are upcoming items AND no ghost is already rendering the "Up next" label (to avoid a duplicate label). Change the existing "Up next" wrapper (line 339) condition from `{upcoming.length > 0 && (` to:

```tsx
              {upcoming.length > 0 && (
                <div className={cn(active && "mt-4", ghostItem && "mt-2")}>
                  <div className="mb-1 flex items-center justify-between">
                    <SectionLabel count={upcoming.length}>
                      {ghostItem ? "Queued" : "Up next"}
                    </SectionLabel>
```

(This renames the second section to "Queued" only when a ghost is present, keeping a single "Up next" label on the ghost and avoiding label duplication. The DnD `SortableContext` `items={upcomingIds}` is unchanged — the ghost is NOT in `upcomingIds`, so it is neither draggable nor draggable-past, satisfying the pinning requirement.)

- [ ] **Step 4: Thread ghostItem through TtsPlayer**

In `src/components/reader/tts-player.tsx`, add the prop to the interface (near line 65, alongside `queueItems`):

```ts
  /** Computed next readable segment to show as a ghost card. */
  ghostItem?: GhostItem | null;
```

Add the import at the top:

```ts
import type { GhostItem } from "@/lib/reader/ghost";
```

Destructure `ghostItem` in the component params (near line 142, alongside the other props), then pass it — and bind the ghost-click to the existing `onSkipNext` — at the `<TtsQueue>` render (line 401):

```tsx
      <TtsQueue
        open={playlistOpen}
        onOpenChange={setPlaylistOpen}
        items={queueItems}
        activeItemId={activeItemId}
        autoAdvanceBook={autoAdvanceBook}
        ghostItem={ghostItem}
        onPlayGhost={onSkipNext}
        onJumpToItem={onJumpToItem}
        onRemove={onRemove ?? (() => {})}
        onClearAll={onClearAll ?? (() => {})}
        onClearUpcoming={onClearUpcoming ?? (() => {})}
        onToggleAutoAdvance={onToggleAutoAdvance ?? (() => {})}
        onReorder={onReorder ?? (() => {})}
      />
```

- [ ] **Step 5: Pass ghostItem from the provider to TtsPlayer**

In `src/components/audio/audio-provider.tsx`, at the `<TtsPlayer>` render (around line 1428, where `onSkipNext={advanceToNextSection}` and `canSkipAhead={canSkipAhead}` are passed), add:

```tsx
            onSkipNext={advanceToNextSection}
            canSkipAhead={canSkipAhead}
            ghostItem={ghostItem}
```

- [ ] **Step 6: Run the queue tests**

Run: `npx vitest run src/components/reader/__tests__/tts-queue.test.tsx`
Expected: PASS (all existing + 4 new ghost cases).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit (on user sign-off)**

```bash
git add src/components/reader/tts-queue.tsx src/components/reader/tts-player.tsx src/components/audio/audio-provider.tsx src/components/reader/__tests__/tts-queue.test.tsx
git commit -m "feat(audio): render auto-advance ghost card in the queue"
```

---

## Task 6: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: PASS. If any pre-existing test breaks, investigate — the only intended behavior change is the toggle-off explicit-spine-advance removal (Global Constraints).

- [ ] **Step 3: Lint**

Run: `npm run lint` (if present in `package.json`; else `npx next lint`)
Expected: PASS.

- [ ] **Step 4: Restart the dev server (audio-provider changes don't reliably hot-reload)**

Run: `kill -9 $(lsof -ti:3000) 2>/dev/null; npm run dev`
Expected: server boots clean.

- [ ] **Step 5: Manual smoke test (in the browser)**

With a book that has a `readableStart`/`readableEnd` window:
1. Open the reader, start TTS on a mid-book chapter with the toggle ON → confirm the dashed ghost card shows the next chapter between "Now playing" and "Up next".
2. Add a manual item from another book to the queue → confirm it appears *below* the ghost, ghost is not draggable, manual item is.
3. Click the ghost → confirm it promotes (plays) and a new ghost appears for the chapter after.
4. Toggle OFF → ghost vanishes; manual queue leads.
5. Play the last readable chapter → no ghost; advancing hits "Book finished."

- [ ] **Step 6: Commit any fixups (on user sign-off)**

---

## Self-Review

**Spec coverage:** every spec section maps to a task — ghost engine (Task 1), readable-start threading + context types (Task 2), `ghostItem` memo + `canSkipAhead` (Task 3), precedence flip across both advance paths (Task 4), UI ghost slot + DnD exclusion + click=skip + option-c coexistence (Task 5), verification incl. the no-prisma-restart note (Task 6). Edge cases (front-matter jump, exhausted→null, toggle-off, non-book active) are covered by Task 1 tests and the Task 3 memo guards.

**Placeholders:** none — every code step contains the actual code.

**Type consistency:** `GhostItem = { sectionHref: string; sectionLabel: string }` is defined once in `ghost.ts` and reused by `resolveGhostItem`, `resolveAdvance`, `AudioContextValue.ghostItem`, `TtsQueueProps.ghostItem`, and `TtsPlayerProps.ghostItem`. `AdvanceDecision` is defined once and consumed only by the provider.

**Note on the `tts-queue` "Up next" → "Queued" label swap:** when a ghost is present, the manual-upcoming section header reads "Queued" so only the ghost carries "Up next". This is the only reasonable reading of "the ghost always occupies the on-deck position" without producing two identical "Up next" headers. Flag for design review during smoke test.
