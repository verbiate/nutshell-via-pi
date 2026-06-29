# Reader Sidebar Smooth Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reader sidebar's shadcn `ScrollArea` (and the Discussions list view's bare `overflow-y-auto` div) with the Bookshelf's `SmoothScrollArea` so every scrollable sidebar surface shares the Lenis momentum + fade-in thumb feel.

**Architecture:** Pure component swap — zero changes to `SmoothScrollArea`, `scrollbar-math.ts`, or `.smooth-scroll-area` CSS. Two edit sites: `reader-sidebar.tsx` (the 4 list-shaped panels' shared wrapper) and `discussions-panel.tsx` (the list-view container only — the in-discussion message stream is deferred to Phase 2). Each swap ships with one minimal DOM-assertion test that fails if the old wrapper is present.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Lenis 1.3, gsap 3.15, Vitest 4 + happy-dom, shadcn/ui `ScrollArea` (being removed from these two sites).

## Global Constraints

- **No edits to `SmoothScrollArea`** (`src/components/library/smooth-scroll-area.tsx`), `scrollbar-math.ts`, or the `.smooth-scroll-area` rules in `src/app/globals.css`. The component is reused as-is.
- **No edits to the Discussions message-stream container** (`discussions-panel.tsx:1773` — the `<div ref={scrollRef} …>` block). Phase 2 only.
- **No moving `SmoothScrollArea` out of `components/library/`.** Cross-folder import is acceptable this phase.
- **Ponytail rule:** No new abstractions, no new files for shared logic, no `forwardRef`/`useImperativeHandle` on `SmoothScrollArea` this phase. The swap is a one-line wrapper change at each site.
- **Test framework:** Vitest 4 + happy-dom. Follow the patterns in `src/components/library/__tests__/smooth-scroll-area.test.tsx` (stub `window.matchMedia`, mock `lenis`, custom `render` via `react-dom/client` + `act`).
- **Commit style:** Follow `git log --oneline -10` for tone. No co-authors, no Claude attribution.
- **No `git push` or PR creation** unless the user explicitly asks.

---

## File Structure

- **Modify:** `src/components/reader/reader-sidebar.tsx` — swap the shared `<ScrollArea>` wrapper (currently lines 128–133) for `<SmoothScrollArea>`. Drop the unused import.
- **Modify:** `src/components/discussion/discussions-panel.tsx` — swap the list-view container (currently line 1400) for `<SmoothScrollArea>`. Leave the message-stream container (line 1773) untouched.
- **Create:** `src/components/reader/__tests__/reader-sidebar.test.tsx` — assert the sidebar wraps panel content in `data-smooth-scroll-root` when a list-shaped tool is active.
- **Create:** `src/components/discussion/__tests__/discussions-panel.test.tsx` — assert the Discussions list view wraps its content in `data-smooth-scroll-root`.

No other files touched. No new components, no new utilities, no new CSS.

---

### Task 1: Swap reader-sidebar ScrollArea → SmoothScrollArea

**Files:**
- Modify: `src/components/reader/reader-sidebar.tsx` (imports + lines 128–133)
- Create: `src/components/reader/__tests__/reader-sidebar.test.tsx`

**Interfaces:**
- Consumes: `SmoothScrollArea` from `@/components/library/smooth-scroll-area` — props `{ children: ReactNode; className?: string }`. Renders `[data-smooth-scroll-root]` on the outer wrapper on desktop + motion-OK; renders `<>{children}</>` on mobile/SSR; renders a plain `overflow-y-auto` div on reduced-motion. The component's own tests already verify these branches — we only verify the sidebar uses it.
- Produces: nothing downstream. The sidebar's external API (`ReaderSidebarProps`) is unchanged.

**Context for the implementer:** `reader-sidebar.tsx` currently imports `ScrollArea` from `@/components/ui/scroll-area` (shadcn/Radix) and wraps every non-bulb panel's content in it. The bulb (Discussions) tool is special-cased at lines 116–126 and stays untouched — `DiscussionsPanel` owns its own internal scroll containers, one of which Task 2 swaps. The other reader panels (Contents / Bookmarks / Notes + Highlights / Book Settings) all flow through the shared `<ScrollArea className="min-h-0 flex-1">` block at lines 128–133. The `pb-12` inner div gives every panel a uniform 48px trailing margin — preserve it verbatim.

- [ ] **Step 1: Write the failing test**

Create `src/components/reader/__tests__/reader-sidebar.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

// ponytail: mock lenis so the desktop branch doesn't try to construct a real
// Lenis (it would, via useGSAP after mount). Matches the smooth-scroll-area
// test setup. The sidebar only needs SmoothScrollArea's outer wrapper to
// render — we never exercise Lenis behavior here.
const { lenisCtor } = vi.hoisted(() => ({
  lenisCtor: vi.fn(function (this: any, opts: unknown) {
    this.on = vi.fn();
    this.scroll = 0;
    this.scrollTo = vi.fn();
    this.destroy = vi.fn();
    this.raf = vi.fn();
    this.__opts = opts;
  }),
}));
vi.mock("lenis", () => ({ default: lenisCtor }));

// ponytail: gsap.ticker.add is called inside useGSAP; spy it so the sidebar
// mount doesn't actually drive a raf loop in happy-dom.
import gsap from "gsap";

vi.mock("@gsap/react", () => ({
  useGSAP: (fn: () => unknown, _opts: unknown) => {
    // ponytail: run the callback once on mount; ignore scope/revertOnUpdate —
    // the sidebar test doesn't exercise cleanup.
    React.useEffect(() => {
      fn();
    }, []);
  },
}));

import { ReaderSidebar } from "../reader-sidebar";

function stubMatchMedia(queries: Record<string, boolean>) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((q: string) => ({
      matches: queries[q] ?? false,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function render(el: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return { container, unmount: () => act(() => root.unmount()) };
}

beforeEach(() => {
  vi.spyOn(gsap.ticker, "add");
  vi.spyOn(gsap.ticker, "remove");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ReaderSidebar — smooth scroll swap", () => {
  beforeEach(() => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": false,
    });
  });

  it("wraps a list-shaped panel in SmoothScrollArea (data-smooth-scroll-root)", () => {
    const panels = {
      // ponytail: only the active tool's panel renders, so we only need one
      // entry. Use "bookmark" — it's the simplest list-shaped tool (not the
      // bulb special-case, not the reader tool that skips the header).
      bookmark: <div data-testid="panel-body">bookmark list</div>,
    };
    const { container } = render(
      <ReaderSidebar
        activeTool="bookmark"
        onToolClick={() => {}}
        panels={panels as any}
      />,
    );
    // ponytail: the whole point of the swap — panel content lives inside a
    // data-smooth-scroll-root wrapper, not a shadcn ScrollArea.
    const root = container.querySelector("[data-smooth-scroll-root]");
    expect(root).not.toBeNull();
    expect(root!.querySelector('[data-testid="panel-body"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/reader/__tests__/reader-sidebar.test.tsx`
Expected: FAIL — `container.querySelector("[data-smooth-scroll-root]")` returns null because the sidebar still wraps the panel in shadcn `ScrollArea`, which renders a `[data-slot="scroll-area"]` root, not `[data-smooth-scroll-root]`.

- [ ] **Step 3: Swap ScrollArea → SmoothScrollArea in reader-sidebar.tsx**

In `src/components/reader/reader-sidebar.tsx`:

1. Remove this import (line 11):
   ```ts
   import { ScrollArea } from "@/components/ui/scroll-area";
   ```
2. Add this import alongside the existing `cn` import:
   ```ts
   import { SmoothScrollArea } from "@/components/library/smooth-scroll-area";
   ```
3. Replace the block at lines 128–133:
   ```tsx
               <ScrollArea className="min-h-0 flex-1">
                 {/* ponytail: pb-12 gives every panel a uniform 48px trailing
                     margin so the last item never butts against the sidebar's
                     bottom edge (matches the px-12 horizontal margin). */}
                 <div className="pb-12">{panels[tool.id]}</div>
               </ScrollArea>
   ```
   with:
   ```tsx
               <SmoothScrollArea className="min-h-0 flex-1">
                 {/* ponytail: pb-12 gives every panel a uniform 48px trailing
                     margin so the last item never butts against the sidebar's
                     bottom edge (matches the px-12 horizontal margin). */}
                 <div className="pb-12">{panels[tool.id]}</div>
               </SmoothScrollArea>
   ```

Leave the bulb (Discussions) special-case at lines 116–126 untouched.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/reader/__tests__/reader-sidebar.test.tsx`
Expected: PASS — `data-smooth-scroll-root` is present and contains the panel body.

- [ ] **Step 5: Run the full reader test suite to catch regressions**

Run: `npx vitest run src/components/reader/`
Expected: PASS — no other reader test asserts on `ScrollArea` in the sidebar. (`tts-player.test.tsx:41` mocks `ScrollArea` for an unrelated component — it stays green.) If any test fails, read the failure: a mock of `ScrollArea` that no longer appears in the sidebar's import graph is fine (it just becomes an unused mock); an assertion that the sidebar renders `[data-slot="scroll-area"]` would need updating to `[data-smooth-scroll-root]`.

- [ ] **Step 6: Commit**

```bash
git add src/components/reader/reader-sidebar.tsx src/components/reader/__tests__/reader-sidebar.test.tsx
git commit -m "feat(reader): swap sidebar ScrollArea for SmoothScrollArea"
```

---

### Task 2: Swap Discussions list-view container → SmoothScrollArea

**Files:**
- Modify: `src/components/discussion/discussions-panel.tsx` (imports + line 1400)
- Create: `src/components/discussion/__tests__/discussions-panel.test.tsx`

**Interfaces:**
- Consumes: `SmoothScrollArea` from `@/components/library/smooth-scroll-area` — same props as Task 1.
- Produces: nothing downstream. `DiscussionsPanel`'s external API (`DiscussionsPanelProps`) is unchanged.

**Context for the implementer:** `discussions-panel.tsx` has TWO scrollable containers — the list view (line 1400, the one this task swaps) and the in-discussion message stream (line 1773, the one this task leaves alone). The list view renders when `activeDiscussionId` is null AND `streamingInitial` is false AND `drafting` is false. The component is "use client" and pulls `useSession`, `useQuery` (TanStack), `useShelfCitedHrefs`, and `useQueryClient` — all need mocking to render the list view in a test. Most `DiscussionsPanelProps` fields are optional; only `bookId`, `pendingRequest`, and `onConsumed` are required. The test renders the panel in the list-view state (no active discussion, no pending request) and asserts the list sits inside `data-smooth-scroll-root`. The message-stream container at line 1773 is rendered by a *different* branch (`activeDiscussionId || streamingInitial || drafting`) — the test never triggers that branch, so its `overflow-y-auto` div stays as-is and isn't asserted on.

The list view is rendered by the `renderListView` helper (or inline equivalent) inside the panel. Read the current lines around 1390–1410 before editing to confirm the exact structure — line numbers may have drifted since this plan was written. The identifying markers: a `<div className="flex-1 min-h-0 overflow-y-auto py-2">` that wraps the discussion list rows. The `overflow-y-auto` and `flex-1 min-h-0` move to `SmoothScrollArea`; `py-2` stays on an inner content div.

- [ ] **Step 1: Write the failing test**

Create `src/components/discussion/__tests__/discussions-panel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

// ponytail: mock lenis — same reason as the sidebar test. We only need
// SmoothScrollArea's outer wrapper to render; Lenis's raf loop isn't
// exercised.
const { lenisCtor } = vi.hoisted(() => ({
  lenisCtor: vi.fn(function (this: any, opts: unknown) {
    this.on = vi.fn();
    this.scroll = 0;
    this.scrollTo = vi.fn();
    this.destroy = vi.fn();
    this.raf = vi.fn();
    this.__opts = opts;
  }),
}));
vi.mock("lenis", () => ({ default: lenisCtor }));

import gsap from "gsap";

vi.mock("@gsap/react", () => ({
  useGSAP: (fn: () => unknown, _opts: unknown) => {
    React.useEffect(() => {
      fn();
    }, []);
  },
}));

// ponytail: the panel calls useSession, useQuery, useQueryClient, and
// useShelfCitedHrefs. Mock each to its minimal happy-path return so the
// list-view branch renders without firing real fetches.
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ user: { role: "regular" } }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    // ponytail: list-view branch needs discussions: []. active-discussion
    // query is gated on activeDiscussionId (null here) so its data stays
    // undefined and is never read.
    data: { discussions: [] },
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-shelf-cited-hrefs", () => ({
  useShelfCitedHrefs: () => ({}),
}));

import { DiscussionsPanel } from "../discussions-panel";

function stubMatchMedia(queries: Record<string, boolean>) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((q: string) => ({
      matches: queries[q] ?? false,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function render(el: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return { container, unmount: () => act(() => root.unmount()) };
}

beforeEach(() => {
  vi.spyOn(gsap.ticker, "add");
  vi.spyOn(gsap.ticker, "remove");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("DiscussionsPanel — list-view smooth scroll swap", () => {
  beforeEach(() => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": false,
    });
  });

  it("wraps the discussion list in SmoothScrollArea (data-smooth-scroll-root)", () => {
    // ponytail: required props only. pendingRequest=null + no active
    // discussion + not drafting → list-view branch renders.
    const { container } = render(
      <DiscussionsPanel
        bookId="b1"
        pendingRequest={null}
        onConsumed={() => {}}
      />,
    );
    // ponytail: the whole point of the swap — the list view's scroll
    // container is data-smooth-scroll-root, not a bare overflow-y-auto div.
    const root = container.querySelector("[data-smooth-scroll-root]");
    expect(root).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/discussion/__tests__/discussions-panel.test.tsx`
Expected: FAIL — `container.querySelector("[data-smooth-scroll-root]")` returns null because the list view still uses a bare `<div className="flex-1 min-h-0 overflow-y-auto py-2">`.

- [ ] **Step 3: Swap the list-view container in discussions-panel.tsx**

In `src/components/discussion/discussions-panel.tsx`:

1. Add this import alongside the existing `cn` import from `@/lib/utils`:
   ```ts
   import { SmoothScrollArea } from "@/components/library/smooth-scroll-area";
   ```
2. Find the list-view container — the `<div className="flex-1 min-h-0 overflow-y-auto py-2">` block (currently line 1400; confirm by grepping for `overflow-y-auto py-2` before editing). Replace:
   ```tsx
       <div className="flex-1 min-h-0 overflow-y-auto py-2">
         {/* …list rows… */}
       </div>
   ```
   with:
   ```tsx
       <SmoothScrollArea className="flex-1 min-h-0">
         <div className="py-2">
           {/* …list rows… */}
         </div>
       </SmoothScrollArea>
   ```
   The `overflow-y-auto` is now owned by `SmoothScrollArea`'s internal viewport; `py-2` moves to an inner content div so it applies to the content, not the viewport. Keep every child element (the discussion rows, the empty state, the "New discussion" button, etc.) exactly where it was — only the wrapper changes.

3. **Do NOT touch** the message-stream container at line 1773 (`<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">`). Phase 2 only.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/discussion/__tests__/discussions-panel.test.tsx`
Expected: PASS — `data-smooth-scroll-root` is present in the list-view branch.

- [ ] **Step 5: Run the full discussion test suite to catch regressions**

Run: `npx vitest run src/components/discussion/`
Expected: PASS — `discussions-home.test.tsx` tests `DiscussionsHomeView` (a different component) and is unaffected. The new `discussions-panel.test.tsx` passes. If `discussions-home.test.tsx` fails, it's unrelated to this swap — investigate separately and don't commit the new test until you understand why.

- [ ] **Step 6: Commit**

```bash
git add src/components/discussion/discussions-panel.tsx src/components/discussion/__tests__/discussions-panel.test.tsx
git commit -m "feat(discussions): swap list-view container for SmoothScrollArea"
```

---

### Task 3: Full verification + manual smoke

**Files:** none modified — verification only.

**Interfaces:** none.

**Context for the implementer:** This is the gate before declaring done. The swaps are visual — automated tests prove the structure, but the actual Lenis feel + fade-in thumb needs a browser check. The dev server is a Turbopack Next.js app on port 3000. The reader sidebar only renders on `sm+` (≥640px) and `SmoothScrollArea` only wires Lenis on `≥1024px`, so the manual smoke must be on a desktop-width viewport.

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: PASS — no new lint errors. The removed `ScrollArea` import in `reader-sidebar.tsx` should not leave an unused-import warning (it's removed, not just unused). The new `SmoothScrollArea` imports are used.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — `SmoothScrollArea`'s props (`{ children: ReactNode; className?: string }`) are compatible with both swap sites. No prop type changes anywhere.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS — all existing tests green, plus the two new tests from Tasks 1 & 2. If `smooth-scroll-area.test.tsx` fails, you accidentally edited `SmoothScrollArea` — revert and re-do the swaps without touching the component.

- [ ] **Step 4: Manual smoke — reader sidebar panels**

1. Start the dev server: `npm run dev` (if a server is already running on port 3000, use it; otherwise `kill -9 $(lsof -ti:3000) && npm run dev`).
2. Open a book in the reader (any book from the bookshelf).
3. With the viewport ≥1024px wide, open each of the four list-shaped tools in the sidebar rail: **Contents** (book-open icon), **Bookmarks** (bookmark icon), **Notes + Highlights** (pen-line icon), **Book Settings** (type icon).
4. In each: scroll the panel content with the mouse wheel. Confirm:
   - The scroll glides with momentum (Lenis smoothing).
   - A slim, semi-transparent scrollbar thumb fades in on scroll, drag, or hover over the right edge; fades out after ~1s idle.
   - The native scrollbar is hidden (no double-scrollbar).
5. Open the **Discussions** (bulb) tool. The **list of past discussions** (not inside a discussion) should show the same Lenis glide + fade-in thumb.
6. Open a discussion (click any row). The **message stream** inside the discussion should scroll with **native scroll** (no Lenis) — this is the deferred Phase 2 surface. Confirm it still scrolls at all (the swap didn't accidentally wrap it).
7. Resize the viewport to <1024px (but ≥640px so the sidebar still shows). Scroll a panel. Confirm it scrolls with native scroll (no Lenis) — `SmoothScrollArea`'s mobile fallback.

- [ ] **Step 5: Manual smoke — reduced motion**

1. In macOS System Settings → Accessibility → Display, enable **Reduce motion** (or in Safari devtools, emulate `prefers-reduced-motion: reduce`).
2. Reload the reader with a panel open and the viewport ≥1024px.
3. Scroll the panel. Confirm it scrolls with native scroll + a visible native scrollbar — `SmoothScrollArea`'s reduced-motion fallback. No Lenis glide, no fade-in thumb.
4. Reset the OS setting when done.

- [ ] **Step 6: Report**

Summarize results to the user:
- Which tools got the smooth-scroll treatment.
- That the Discussions list view is smooth-scrolling and the in-discussion message stream is still native scroll (Phase 2).
- Lint / typecheck / test / smoke outcomes.
- The two commit hashes.

No commit in this task — it's verification only. If anything fails, fix it under a new commit (or amend the relevant task's commit if not yet pushed and the user hasn't asked to avoid amending).

---

## Self-Review

**1. Spec coverage:**
- "The 4 list-shaped reader panels" → Task 1 swaps the shared wrapper that serves all four. ✓
- "Discussions list view" → Task 2 swaps the list-view container. ✓
- "Out of scope (deferred): the Discussions message-stream container" → Task 2 Step 3 explicitly says "Do NOT touch the message-stream container at line 1773." ✓
- "No edits to `SmoothScrollArea`, `scrollbar-math.ts`, `globals.css`" → Global Constraints + Task 3 Step 3 (`smooth-scroll-area.test.tsx` failure = you edited the component). ✓
- "At most one `SmoothScrollArea` mounted at a time" → no change to `displayedTool` logic. ✓
- Testing: two new minimal tests, each asserting `data-smooth-scroll-root`. ✓
- Visual effect: manual smoke covers it. ✓

**2. Placeholder scan:** No "TBD" / "implement later" / "add appropriate error handling". Every code step has full code. The one "…list rows…" ellipsis in Task 2 Step 3 is a placeholder for content that already exists and is explicitly left unchanged — the instruction says "Keep every child element exactly where it was — only the wrapper changes." That's not a placeholder, it's a preserve instruction.

**3. Type consistency:** `SmoothScrollArea` props are `{ children: ReactNode; className?: string }` in both tasks. The import path `@/components/library/smooth-scroll-area` is identical in both. No type drift.

No issues found.
