# Discussion Section Attachments — Design

**Date:** 2026-06-26
**Status:** Approved (delegated)
**Scope:** Let a user attach additional book sections to an existing discussion as extra context. First slice of the "Multi-context attachments" work deferred by `2026-06-26-discussions-restructuring-design.md`.

## Behavior

- A `+ Add section` button appears at the end of the "Context" chip row in the composer area.
- Clicking opens a searchable picker (Popover + cmdk `Command`) listing the book's sections (from `buildSpinePlaylist`).
- Selecting a section adds it as a **draft** chip in the Context row. Draft chips have an `x` to remove.
- The picker hides sections already attached (draft or persisted) and the discussion's origin section.
- On send: draft attachments are POSTed with the message and persisted as `DiscussionAttachment` rows **before** the response streams. After persistence they are **permanent**:
  - Rendered as chips with no `x`.
  - Their text is appended to the system prompt on **every** follow-up (mirrors how the origin context is re-sent today).
- Applicable to all origin types (book / section / passage discussions).
- The **origin** section/passage stays sticky (no `x`), continues to pin the cache key — unchanged.
- **Sections only this slice.** The schema is type-agnostic so the queued "passages as attachments" slice is a pure addition (new `type` value, optional `passageText`/`passageCfi` columns already present).

## Data model (`src/server/db/schema.prisma`)

New table:
```prisma
model DiscussionAttachment {
  id           String   @id @default(cuid())
  discussionId String
  type         String   // "section" now; "passage" later
  sectionHref  String?
  passageText  String?  // reserved for the passages slice
  passageCfi   String?  // reserved for the passages slice
  createdAt    DateTime @default(now())

  discussion   Discussion @relation(fields: [discussionId], references: [id], onDelete: Cascade)

  @@index([discussionId])
}
```
Add `attachments DiscussionAttachment[]` relation on `Discussion`.

**Uniqueness:** No unique constraint — a user may legitimately re-add a section after removing the draft (pre-send). Post-send duplicates are prevented client-side (picker hides attached). A cheap `@@index([discussionId])` covers the per-discussion read.

**Migration:** Pure addition; no backfill. Run `db:generate` + `db:push`, then restart `npm run dev` (stale-PrismaClient rule, AGENTS.md).

## Services (`src/server/services/discussions.ts`)

- `streamFollowup`: accept optional `attachments: { type: "section"; sectionHref: string }[]`. Persist them as `DiscussionAttachment` rows (dedup against existing attachments by `type`+`sectionHref`) right after the user message is saved, before the system prompt is built.
- `rebuildSystemPrompt`: after building the origin prompt, load the discussion's attachments; for each `section` attachment, `extractSectionText(book.epubPath, href)` and append a labeled block:
  ```
  \n\n=== Additional context (sections the reader attached) ===\n\nSection: <title>\n<text>\n\n...
  ```
  Titles resolved from `tocJson` (basename match, same helper logic as `buildSectionPrompt`).
- `getDiscussionWithMessages`: `include: { attachments: true }` so the client can render permanent chips.

Cache key / `contentHash` / explainer versioning / reroll: **untouched**. Attachments only affect per-user follow-up turns, which are never cached.

## API

- `POST /api/discussions/[id]/messages`: body extended to `{ content, attachments?: [{type:"section"; sectionHref}] }`. Threaded through to `streamFollowup`.
- `GET /api/discussions/[id]`: response now includes `discussion.attachments`.

## UI

- New `src/components/ui/popover.tsx` (standard shadcn, from the already-installed unified `radix-ui` package — no new dependency). Used with the existing `Command` primitive to make a searchable combobox.
- `DiscussionsPanel`:
  - New `sectionOptions: { href: string; label: string }[]` prop (source of picker items).
  - New state: `draftAttachments: { type:"section"; sectionHref: string; label: string }[]`. Persisted attachments come from `activeData.discussion.attachments`.
  - Context chip row renders, in order: `This book` → origin (sticky, clickable deeplink) → persisted attachments (no `x`, clickable deeplink) → draft attachments (with `x`). Then the `+ Add section` Popover trigger.
  - `sendFollowup`: includes `draftAttachments` in the POST body; clears `draftAttachments` on success (the active-discussion refetch surfaces them as persisted).
- `reader-client.tsx`: compute `sectionOptions` from the existing `buildSpinePlaylist(spineItems, toc)` (already built for `sectionLabelByBaseHref`) and pass it to `DiscussionsPanel`.

## Token-budget indicator

Attached section text is re-extracted server-side on each follow-up, so the client can't count it precisely. This deepens the existing known undercount for section-origin discussions (`discussions-panel.tsx:1472`). The indicator stays advisory; no change required. Noted in a comment.

## Edge cases / testing (Vitest)

- `streamFollowup` persists attachments before generating; follow-up prompt includes each attached section's text.
- Duplicate attachment (same `type`+`sectionHref`) on send is deduped (no duplicate rows).
- `rebuildSystemPrompt` with zero attachments is unchanged from today (no suffix appended).
- Attachments cascade-delete with the discussion (FK).
- Picker hides origin + already-attached sections.

## Deferred (out of scope)

- **Passages as attachments** — next slice; columns already reserved.
- **Per-message attachment history surfacing** — "added on turn N" UI; not requested.
- **Removing persisted attachments** — they are permanent by design (confirmed).
