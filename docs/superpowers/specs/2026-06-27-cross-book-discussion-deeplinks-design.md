# Cross-Book Discussion Deep Links — Design

**Date:** 2026-06-27
**Status:** Awaiting sign-off
**Scope:** Let a discussion cite sections of an *attached* (co-primary) book, with clickable deep links that navigate the reader to that section of the other book and surface the discussion in that book's discussions list. Builds on the `#ch:` citation scheme shipped by `2026-06-26-explainer-deep-links-design.md` and the book-attachment slice shipped by `2026-06-26-discussion-section-attachments-design.md`.

## Goal

Two capabilities, both gated on a book being attached to the discussion:

1. **Cross-book citations.** When the LLM references a chapter of an attached book, the reference renders as a clickable deep link that jumps the reader to that section of the other book — exactly like today's within-book `#ch:` links, but across the book boundary.
2. **Symmetric listing.** A discussion originally created in book 1 that has book 2 attached also appears in book 2's discussions list. Opening it from book 2 keeps the conversation alive in book 2's context.

Triggered use case: a user attaches a second book to compare/contrast, asks "how does chapter 3 of book 2 handle X?", clicks the link in the response, and lands in book 2's reader with the discussion panel open — ready to keep talking.

## User stories

1. As a reader with book 2 attached to a discussion, when an assistant message mentions a chapter of book 2 by name, I can click it to close the sidebar, navigate to book 2, land on that section in the reader, **and** have the same discussion open in book 2's Discussions panel.
2. As a reader browsing book 2's discussions list, I see discussions that were created in book 1 but have book 2 attached — they look and behave like any of book 2's own discussions, with a subtle hint that they're multi-book.
3. As a reader, citing works symmetrically: a discussion can cite the origin book's chapters (today's behavior, unchanged) and any attached book's chapters (new), in the same response.
4. As a reader, old cached explainer/discussion text with the original `#ch:<basename>` form still renders and clicks correctly (immutable cached content must not break).

## Non-goals (YAGNI)

- **A new `DiscussionBook` join table.** Attached books are co-primary via the existing `DiscussionAttachment` (`type:"book"`) rows; the list query unions over them. A join table is a strict superset we can add later if a true origin/co-primary query distinction is ever needed (analytics, "detach origin"). See "Decisions."
- **URL query params** for the target section/discussion (e.g. `?discussion=…&section=…`). Would be shareable/bookmarkable but diverges from the codebase's pending-flag architecture. The TTS "now playing" precedent (`pendingReaderSyncBookId`) doesn't use them either.
- **A "promote on follow-up" event.** Attaching a book makes it co-primary immediately; a separate promotion trigger would be redundant.
- **Short citation aliases** (`#ch:B2:…` via a per-discussion map). Raw `bookId` cuid in the href is stateless and good enough for v1; revisit if token cost shows up in metrics.
- **Re-rendering old cached text** to the new scheme. Cached is immutable; old `#ch:` links keep working via the unchanged fallback path.
- **Passage-level cross-book deep links.** Cross-book citations are chapter/section-level, matching the within-book scheme.
- **Reassigning the origin book.** `Discussion.bookId` stays as the immutable origin; deletion still cascades from it.

## Decisions (resolved)

| Axis | Decision | Why |
|---|---|---|
| Citation form | `#ch:<bookId>:<basename>` for attached books; `#ch:<basename>` unchanged for origin | Stateless (renderer slices bookId, no per-discussion map to maintain); cached origin-book text keeps working |
| bookId encoding | Raw cuid (~24 chars) in the href | Zero mapping state; honest tradeoff on token cost vs. aliases |
| Co-primary model | Attach = co-primary, immediately; no new table | Delivers symmetric listing + symmetric follow-ups (the user-visible outcome) with zero schema change beyond one index. Attachments already re-send full text every turn, so prompt context is already symmetric |
| List scoping | Query-time union over `DiscussionAttachment` (`type:"book"`) | Retroactive, no denormalization, no sync burden |
| Cross-book nav mechanism | New `pendingReaderNav` one-shot context field, cloned from the TTS `pendingReaderSyncBookId` pattern | Proven pattern; the TTS path can't be reused directly because it pulls the target from the live audio session, not a click-time param |
| Arrival behavior | Reader navigates to the cited section **and** the Discussions panel auto-opens to the discussion | User's explicit choice; lets the conversation continue in the new book's context |
| Origin semantics | `Discussion.bookId` = origin (immutable, cascade-delete anchor); not "primary" in a hierarchical sense | Preserves the cache key, delete cascade, and origin section/passage metadata without churn |

## Architecture

### The coordinate system, extended

Today the citation scheme is single-book: `[Label](#ch:<basename>.xhtml)` where the basename is unique within the *currently open* book's spine. The chapter map is injected once via `{{chapter_index}}` from the origin book's `tocJson` (`prompt-builder.ts:85-107`).

For cross-book citations we extend the scheme with a **bookId prefix**:

```
[Chapter 3](#ch:<bookId>:chapter3.xhtml)
```

Parsing rule: if the href matches `^[a-z0-9]{8,}:` (a cuid-form prefix; `@default(cuid())` emits ~24-char base36 ids), split into `(bookId, basename)`; else it's the origin-book form (today's behavior, byte-for-byte unchanged). The 8+ char alphanumeric prefix is unambiguous against any real EPUB spine basename — no spine href in the wild starts with 8+ lowercase-alphanumerics followed by `:` (and the validator still checks the bookId against the loaded attachments map, so a coincidental match can't produce a clickable dead link).

### Validation: the multi-book spine problem

`ExplainerContent` today validates a citation against the *currently open* book's live spine (`isValidHref(target, spineHrefs)` at `explainer-content.tsx:23`). Cross-book citations to an attached book would fail that check (the open book is the origin, not the attached one) and silently degrade to plain text — the link would never be clickable.

Fix: the validator must see **every relevant book's hrefs**. Source: `EpubFile.tocJson` for attached books (already loaded service-side by `buildAttachmentSuffix` for full-text injection). Surface it to the panel as `attachedBookHrefs: Record<bookId, string[]>` and thread to `ExplainerContent` alongside the existing `spineHrefs`.

- Origin-book citation (`#ch:<basename>`) → validate against live `spineHrefs` (today's path).
- Attached-book citation (`#ch:<bookId>:<basename>`) → validate against `attachedBookHrefs[bookId]`.

### Click → cross-book navigation

The TTS player's `goToBook` (`tts-player.tsx:220-248`) is the precedent for book-to-book nav: plain `router.push('/book/<bookId>/reader')`, reader stays mounted via the layout-level `ReaderMount`, no scene transition. But the TTS path pulls the target section from the *live audio session* (`session.flatToc[session.currentIndex]`) after arrival — it carries no section info in the pending flag. A click on a citation knows its target at click time, so we need a richer pending field.

New `ReaderNavContext` (AudioContext is misnamed for non-audio concerns; SceneTransitionContext is shelf↔reader only):

```ts
type PendingReaderNav = { bookId: string; href?: string; discussionId?: string } | null
```

- `markPendingReaderNav(payload)` — ref-backed one-shot, no re-render (mirrors `pendingReaderSyncBookId`'s "ponytail" comment at `audio-context.ts:108-118`).
- `clearPendingReaderNav()` — consumed by the destination reader.

### Data flow (life of a cross-book citation)

1. **Build** (`discussions.ts:buildAttachmentSuffix` ~`:919`): for each `type:"book"` attachment, append a chapter-map block built from `attachment.book.tocJson` via `buildChapterIndex`, with each href rewritten to `#ch:<book.id>:<basename>`. One-line instruction per block: *"For citations to {Title}, copy the prefixed hrefs below verbatim."*
2. **Generate**: the model copies a prefixed href verbatim into the response, exactly as it does for origin-book hrefs today. Streamed + persisted as ordinary text.
3. **Follow-up reinforcement** (`FOLLOWUP_CITATION_SUFFIX` at `discussions.ts:48-49`): add a cross-book example so the model generalizes the rule to follow-ups.
4. **Render** (`explainer-content.tsx`): `parseBookRef(href)` → if `bookId` present and `attachedBookHrefs[bookId]` includes `basename`, render as clickable span calling `onNavigateToBookSection(bookId, basename)`; else fall through to today's `onNavigateToHref(basename)`; else plain text.
5. **Navigate (origin side)**: click handler in `reader-client.tsx` (extends the existing `onNavigateToHref` wiring at `:1549-1561`) → collapse the sidebar panel (clean handoff) → `markPendingReaderNav({bookId, href, discussionId: currentDiscussionId})` → `router.push('/book/<bookId>/reader')`.
6. **Arrive (destination side)**: destination `reader-client.tsx` mount effect (sibling to the TTS sync effect at `:399-438`) consumes the pending nav on book-ready → `viewer.navigateTo(resolveToSpineHref(href, destinationSpineHrefs))` → open the sidebar to the Discussions tool → open the discussion thread → `clearPendingReaderNav()`. Sidebar state sequence: collapsed on the origin side during transit, reopened to the Discussions tab on arrival (matches the user's "close sidebar → navigate → reopen to that discussion" intent).

### Listing: query-time union

`listDiscussionsForBook(userId, bookId)` (`discussions.ts:539`) becomes:

```ts
where: { userId, OR: [
  { bookId },                                                // origin
  { attachments: { some: { type: "book", bookId } } }       // co-primary (attached)
] }
```

To keep the union's `some` filter fast, add `@@index([bookId, type])` to `DiscussionAttachment` (only `@@index([discussionId])` exists today at `schema.prisma:435`).

## Changes by file

| File | Change |
|---|---|
| `src/server/db/schema.prisma:435` | Add `@@index([bookId, type])` to `DiscussionAttachment`. Minor migration, no data change. |
| `src/lib/explainer/citations.ts` | Extend `CITE_RE` (`:11`) to optionally capture `<bookId>:` prefix; add `parseBookRef(href) → { bookId: string \| null, basename }`; extend `isValidHref` to accept an optional per-book href map. Add unit-test cases + extend the `__main__` self-check (`:67-73`). |
| `src/server/services/prompt-builder.ts` | Factor href rewriting so `buildChapterIndex` can emit either form; add `buildAttachedChapterIndex(book)` producing the prefixed form. Existing `{{chapter_index}}` behavior unchanged. |
| `src/server/services/discussions.ts` | `buildAttachmentSuffix` (~`:919`): inject attached books' ToCs via `buildAttachedChapterIndex`. `FOLLOWUP_CITATION_SUFFIX` (`:48`): add cross-book example. `listDiscussionsForBook` (`:539`): union query. `getDiscussionWithMessages` (`:568`): include `attachments.book.{id,title,coverPath,tocJson}` so the panel can build `attachedBookHrefs` and the display hint without an extra round-trip. |
| `src/components/explainer/explainer-content.tsx` | New optional props: `attachedBookHrefs: Record<string, string[]>`, `onNavigateToBookSection?: (bookId, basename) => void`. Render branch on `parseBookRef`. |
| `src/components/discussion/discussions-panel.tsx` | Build `attachedBookHrefs` from the active discussion's attachments (`JSON.parse(book.tocJson)` → hrefs). Thread new props to `ExplainerContent` inside `MessageBubble` (`:1973-1977`). ListView (`:1112`): when `discussion.bookId !== currentBookId`, render a subtle visual signal that this is a multi-book discussion (exact treatment — stacked covers, subtitle, icon — decided at implementation time against the existing row layout). Requirement: communicate "this discussion also involves {originTitle}" without implying secondary status. |
| `src/components/reader/reader-nav-context.tsx` *(new, ~25 lines)* | `PendingReaderNav` type + `mark/clear` actions. Ref-backed one-shot. |
| `src/components/providers.tsx` | Mount `ReaderNavProvider`. |
| `src/components/reader/reader-client.tsx` | Consume `pendingReaderNav` in a new mount effect (sibling to `:399-438`): on book-ready, navigate viewer, switch sidebar to Discussions, open the discussion, clear the flag. Extend the `onNavigateToHref` wiring at `:1549-1561` to also pass `onNavigateToBookSection` that closes the sidebar, marks pending, and `router.push`es. |

## Edge cases

- **Hallucinated `<bookId>:<basename>`** not in `attachedBookHrefs[bookId]` → degrades to plain text; never a dead jump (mirrors today's invalid-href behavior).
- **Attached book's `tocJson` is null/empty** (legacy row) → `attachedBookHrefs[bookId]` is `[]` → all that book's citations degrade to plain text. Acceptable; matches today's behavior for an origin book with no ToC.
- **Origin-book citation in cached text** (`#ch:<basename>`) → unchanged path, still works byte-for-byte. No re-render of cached content.
- **Mixed response** — model cites both origin and attached book in one message → both render and click correctly via their respective handlers.
- **Stale `pendingReaderNav`** (user navigates away mid-flight) → consumed-once semantics; if the destination never mounts, the flag sits until next reader mount or is cleared on a different book's mount effect. Acceptable; matches `pendingReaderSyncBookId` behavior.
- **Book access revoked between attach and click** → destination reader's `getBookForUser` (server gate at `page.tsx`) redirects; pending nav is silently dropped. No leak.
- **Discussion deleted while pending nav in flight** → on arrival, the discussions list refetch won't find it; panel opens to the list, not the thread. Graceful.
- **Book-to-book: same book** — a citation to the *origin* book uses the unprefixed form, so this can't happen. (If the model erroneously emits `#ch:<originBookId>:<basename>`, treat it as a cross-book link to the same book: navigate "to" the same URL, no-op the route change, still navigate the viewer + open the discussion. Belt-and-suspenders; the prompt doesn't suggest this form for the origin book.)
- **Deletion**: deleting the origin book cascades the discussion (unchanged). Deleting an attached (co-primary) book cascades only its `DiscussionAttachment` row; the discussion survives under the origin book. Matches the asymmetric-but-sensible delete semantics.

## Testing strategy

- **Vitest unit tests** on `src/lib/explainer/citations.ts` (pure functions — the deterministic boundary):
  - `parseBookRef`: prefixed form splits correctly; unprefixed returns `{bookId: null}`; cuid vs. non-cuid prefix discrimination; malformed `:` cases.
  - `isValidHref` (extended): prefixed validates against the per-book map; unprefixed unchanged.
  - Cached origin-form text still parses correctly (regression).
  - Extend the `__main__` self-check per ponytail convention.
- **`prompt-builder.test.ts`**: assert `buildAttachedChapterIndex` emits the prefixed form; `buildChapterIndex` (origin) is unchanged.
- **`discussions` service tests**: `listDiscussionsForBook` returns discussions where the book is origin OR attached; doesn't return unrelated books' discussions.
- **The nav/arrival flow is React-context + router-heavy** — manual verification via the dev server:
  1. Open a discussion in book 1, attach book 2, ask "what does chapter N of book 2 say?", confirm the response contains a prefixed citation that renders as a clickable link.
  2. Click the link → sidebar closes, reader navigates to book 2's chapter N, Discussions panel opens to the same thread.
  3. From book 2's discussions list, confirm the discussion appears (multi-book hint visible). Open it; send a follow-up; confirm the follow-up works and cites can target either book.
  4. Confirm old within-book `#ch:` citations in cached explainers still click correctly (regression).

## Cache cost

None. Cross-book citations only appear in **per-user follow-up turns** (attachments shape the uncached follow-up prompt, not the cached explainer). The cached explainer is the origin book only — unchanged. `contentHash`, `promptVersion` invalidation, reroll: untouched.

## Migration

- Schema: add `@@index([bookId, type])` to `DiscussionAttachment`. Run `db:generate` + `db:push`, then **restart `npm run dev`** per the AGENTS.md stale-PrismaClient rule.
- No data backfill — the union query is retroactive over existing `type:"book"` attachment rows.
- No prompt-template reseed — the cross-book instructions live in `buildAttachmentSuffix` (runtime) and `FOLLOWUP_CITATION_SUFFIX` (runtime constant), not in `PromptTemplate` rows. The origin-book `{{chapter_index}}` injection and seeded templates are untouched.

## Deferred (out of scope)

- **`DiscussionBook` join table** — if a true origin/co-primary query distinction is ever needed (analytics, admin tooling, "detach origin" feature).
- **Short citation aliases** (`B2`-style) — if token-cost metrics justify the per-discussion mapping state.
- **URL query params** for shareable/bookmarkable cross-book deep links — would also enable deep-linking from outside the app.
- **Passage-level cross-book deep links** — would need offset→CFI mapping that does not exist today.
- **Aggregated "Links in this discussion" panel extended for cross-book** — the existing Links panel (`explainer-deep-links-design.md`) currently groups by spine reading order; extending it to group by book is a UI-only follow-up, not blocked by this work.
