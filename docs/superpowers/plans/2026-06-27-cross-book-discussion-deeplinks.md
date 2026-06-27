# Cross-Book Discussion Deep Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let discussions cite sections of attached (co-primary) books via `#ch:<bookId>:<basename>` deep links, navigate the reader cross-book on click, and list the discussion under every co-primary book.

**Architecture:** Extend the existing `#ch:` citation scheme with an optional `<bookId>:` prefix (the regex already captures it — only a parser helper is added). Inject attached books' ToCs into the follow-up prompt. Clone the TTS player's `pendingReaderSyncBookId` one-shot pattern into a new `ReaderNavContext` that carries a click-time target. List via a query-time union over `DiscussionAttachment type:"book"` — no new table.

**Tech Stack:** Next.js 16 App Router, Prisma 5.22 (SQLite), React 19 Context (no Zustand), react-markdown, existing `#ch:` citation core (`src/lib/explainer/citations.ts`).

**Spec:** `docs/superpowers/specs/2026-06-27-cross-book-discussion-deeplinks-design.md`

## Global Constraints

- Prisma pinned at 5.22 (NOT 7) — `package.json`
- No new dependencies — `@likecoin/epub-ts`, `react-markdown`, `remark-gfm` already installed
- Cached explainer/discussion text is immutable — the origin-book `#ch:<basename>` form MUST keep rendering and clicking byte-for-byte
- After any `schema.prisma` edit: run `db:generate` + `db:push`, then restart `npm run dev` (AGENTS.md stale-PrismaClient rule)
- `Discussion.bookId` stays as immutable origin; attach = co-primary (no new table)
- Ponytail: shortest diff, stdlib-first, no unrequested abstractions

## Interfaces (locked, type-consistent across tasks)

```ts
// src/lib/explainer/citations.ts (Task 1)
export function parseBookRef(href: string): { bookId: string | null; basename: string };
//   cuid-form prefix → bookId; else bookId null. Discriminator: ^[a-z0-9]{8,}:

// src/server/services/prompt-builder.ts (Task 2)
export function buildChapterIndex(
  tocJson: string | null | undefined,
  cap?: number,
  bookId?: string,   // NEW: when set, hrefs prefixed as #ch:<bookId>:<basename>
): string;

// src/components/explainer/explainer-content.tsx (Task 3)
//   New optional props:
attachedBookHrefs?: Record<string, string[]>;
onNavigateToBookSection?: (bookId: string, basename: string) => void;

// src/components/reader/reader-nav-context.tsx (Task 4)
type PendingReaderNav = { bookId: string; href?: string; discussionId?: string } | null;
useReaderNav(): { pendingReaderNav, markPendingReaderNav, clearPendingReaderNav };
```

---

## Task 1: `parseBookRef` + schema index (foundation)

**Files:**
- Modify: `src/lib/explainer/citations.ts` (add `parseBookRef`, extend self-check)
- Modify: `src/server/db/schema.prisma:435` (add `@@index([bookId, type])`)
- Test: `src/lib/explainer/__tests__/citations.test.ts` (extend or create)

**Produces:** `parseBookRef` consumed by Task 3; index consumed by Task 2's union query.

- [ ] Write failing tests for `parseBookRef`: prefixed splits, unprefixed returns null, short prefix (`part1:`) returns null, no-colon returns null, cuid-length alphanum prefix splits.
- [ ] Run → confirm fail.
- [ ] Implement `parseBookRef` (regex `^[a-z0-9]{8,}:` discriminator, split on first `:`).
- [ ] Extend the `__main__` self-check at `citations.ts:67-73`.
- [ ] Add `@@index([bookId, type])` to `DiscussionAttachment`.
- [ ] Run `npx prisma db generate && npx prisma db push` (dev DB).
- [ ] Run all citation tests → pass.
- [ ] Commit: `feat(citations): parseBookRef for cross-book hrefs + attachment index`

## Task 2: Server — prompt injection + union list query

**Files:**
- Modify: `src/server/services/prompt-builder.ts:85-107` (add optional `bookId` param to `buildChapterIndex`)
- Modify: `src/server/services/discussions.ts`:
  - `FOLLOWUP_CITATION_SUFFIX` (`:48-49`) — add cross-book example
  - `buildAttachmentSuffix` (`:984-1007`) — inject each attached book's prefixed ToC map
  - `listDiscussionsForBook` (`:539-548`) — union query + include origin `book` display fields
  - `getDiscussionWithMessages` (`:581`) — add `tocJson` to attached `book` select

**Consumes:** `buildChapterIndex(tocJson, cap, bookId)` from Task 1's sibling.
**Produces:** API responses now carry `attachedBook.tocJson`; list query returns cross-listed discussions.

- [ ] Add `bookId?` param to `buildChapterIndex`; thread into the href emission.
- [ ] Extend `FOLLOWUP_CITATION_SUFFIX` with one cross-book exemplar line.
- [ ] In `buildAttachmentSuffix`'s book loop: add `tocJson` to the `select`, call `buildChapterIndex(ab.tocJson, 200, ab.id)`, append the map block under each book's text with a one-line copy-verbatim instruction.
- [ ] Rewrite `listDiscussionsForBook` where-clause to the `OR` union; include `book: { select: { id, title, coverPath } }`.
- [ ] Add `tocJson` to `getDiscussionWithMessages`'s attached-book select.
- [ ] Manual `npx tsx -e` smoke check: call `listDiscussionsForBook` for a book that has an attached-from discussion; confirm it returns.
- [ ] Commit: `feat(discussions): inject attached-book ToCs + cross-list via union query`

## Task 3: Renderer — `ExplainerContent` cross-book branch

**Files:**
- Modify: `src/components/explainer/explainer-content.tsx` (add props + branch)
- Modify: `src/components/discussion/discussions-panel.tsx` (build `attachedBookHrefs`, thread new props to `ExplainerContent` at `:1973-1977`)

**Consumes:** `parseBookRef`, `isValidHref` from Task 1; `attachedBookHrefs` built from Task 2's `tocJson`.
**Produces:** Cross-book citations render as clickable spans calling `onNavigateToBookSection`.

- [ ] Add `attachedBookHrefs?` + `onNavigateToBookSection?` props to `ExplainerContent`.
- [ ] In the `a` renderer: after slicing `#ch:`, call `parseBookRef(target)`; if `bookId` present, validate `isValidHref(basename, attachedBookHrefs[bookId] ?? [])` and call `onNavigateToBookSection(bookId, basename)`; else today's path.
- [ ] In `discussions-panel.tsx`: `useMemo` over active discussion's `attachments` → build `Record<bookId, hrefs[]>` from each `book.tocJson` (parse ToC items, push `hrefBasename`).
- [ ] Thread `attachedBookHrefs` + a new `onNavigateToBookSection` prop down to `ExplainerContent` in `MessageBubble`.
- [ ] Verify in browser: old `#ch:basename` still renders (regression); a synthetic prefixed href in a test message renders clickable.
- [ ] Commit: `feat(explainer): render cross-book citations as clickable links`

## Task 4: Navigation — `ReaderNavContext` + cross-book click handler

**Files:**
- Create: `src/components/reader/reader-nav-context.tsx` (~30 lines)
- Modify: `src/components/providers.tsx` (mount `ReaderNavProvider`)
- Modify: `src/components/reader/reader-client.tsx`:
  - Consume `pendingReaderNav` in a new mount effect (sibling to the TTS sync effect at `:399-438`)
  - Extend the `onNavigateToHref` wiring at `:1549-1561` to also pass `onNavigateToBookSection`

**Consumes:** `PendingReaderNav` shape; `useReaderNav` from the new context.
**Produces:** Click on cross-book citation → close sidebar → mark pending → `router.push` → on arrival, viewer navigates + Discussions panel opens to the thread.

- [ ] Create `reader-nav-context.tsx`: `PendingReaderNav` type, `createContext`, `useReaderNav` hook with the missing-provider error, `ReaderNavProvider` holding a ref-backed one-shot (mirrors `pendingReaderSyncBookId`).
- [ ] Mount `ReaderNavProvider` in `providers.tsx` (alongside `AudioProvider`).
- [ ] In `reader-client.tsx`: add the consumption effect — on book-ready + `pendingReaderNav.bookId === bookId`, call `viewer.navigateTo(resolveToSpineHref(href, spineHrefs))`, switch sidebar to Discussions tool, open the discussion, then `clearPendingReaderNav()`.
- [ ] Add `onNavigateToBookSection(bookId, basename)` handler in `reader-client.tsx`: close sidebar → `markPendingReaderNav({bookId, href: basename, discussionId: activeDiscussionId})` → `router.push('/book/<bookId>/reader')`.
- [ ] Pass `onNavigateToBookSection` through `DiscussionsPanel` → `ExplainerContent`.
- [ ] Commit: `feat(reader): cross-book deep-link navigation via ReaderNavContext`

## Task 5: Display hint + end-to-end browser verification

**Files:**
- Modify: `src/components/discussion/discussions-panel.tsx:1112-1235` (ListView row hint for cross-listed discussions)

**Consumes:** `DiscussionPreview` enriched with origin book fields (Task 2).
**Produces:** Cross-listed rows show a subtle multi-book signal.

- [ ] Extend the `ListView` row: when `discussion.bookId !== currentBookId`, render a small `↗ {originTitle}` subtitle or stacked-cover cluster below the preview (decided against the existing row layout).
- [ ] Restart dev server: `kill -9 $(lsof -ti:3000) && npm run dev` (schema changed in Task 1; stale-PrismaClient rule).
- [ ] **BrowserOS-MCP end-to-end test:**
  1. Open a book in the reader; open Discussions; start a discussion.
  2. Attach a second book; ask "what does chapter N of {Book 2} say?"
  3. Confirm the response contains a prefixed citation rendering as a clickable link.
  4. Click the link → sidebar closes, reader navigates to Book 2's chapter N, Discussions panel opens to the same thread.
  5. Navigate to Book 2's library/reader; open Discussions; confirm the cross-listed discussion appears with the multi-book hint.
  6. Open it from Book 2's list; send a follow-up; confirm it works.
  7. Regression: open an old discussion with origin-book `#ch:` citations; confirm they still click.
- [ ] Commit: `feat(discussions): multi-book hint on cross-listed discussion rows`

## Self-review notes

- **Regex unchanged** — `CITE_RE`'s `[^)\s]+` already includes cuid chars + `:`, so the prefixed form is captured by existing `parseCitations`/`segmentText`. Only `parseBookRef` is new.
- **`isValidHref` reused** — basename matching is book-agnostic; cross-book validation just passes a different href array.
- **`resolveToSpineHref` reused** — called with the *destination* book's spine after arrival (the pending-nav effect runs on the destination reader mount).
- **Cache key untouched** — cross-book citations only appear in per-user follow-up turns (uncached).
- **Delete cascade unchanged** — origin book deletion cascades the discussion; attached-book deletion cascades only the attachment row.
