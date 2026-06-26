# Explainer Deep Links

**Date**: 2026-06-26
**Status**: Approved (chapter-level, derived panel, all 3 explainer types)
**Scope**: Conversational explainer threads (the "ask the book" surface); inline citation links + per-discussion "Links" panel

## Goal

When an explainer references where something occurs in the book, render that
reference as a clickable link that jumps the reader to that chapter/section.
Also aggregate every citation in a discussion into a "Links in this discussion"
panel — a navigable map of everywhere the discussion reaches in the book.

Triggered use case: a user asks the book "What chapter does the author
describe X?" and clicks the answer to jump there.

## User stories

1. As a reader, when an explainer message mentions a chapter/section by name, I
   can click it to jump the reader there.
2. As a reader, I can open a "Links in this discussion" view that lists every
   location the current discussion cited, deduped and in book reading order,
   and click any entry to jump there.
3. As a reader, links work the same whether I'm reading the discussion in the
   sidebar or in the pop-out modal.
4. As a reader, following a link from the modal jumps the reader behind the
   overlay and closes the modal so I can read.

## Non-goals (YAGNI)

- Paragraph/sentence-level precision (future iteration; would need offset→CFI
  mapping that does not exist today and fuzzy quote matching)
- A separate structured side-channel / tool-call citation list (derived view is
  sufficient for chapter granularity)
- A schema change — citations live inline in existing `Explainer.content` /
  `ExplainerMessage.content` text
- Links on the one-shot (non-threaded) explainer surfaces — threads are the
  only live render surface today (`ExplainerThreadsPanel`)
- External links — only the `#ch:` scheme is intercepted; everything else
  renders as plain text so explainers cannot become an arbitrary-link vector
- Cross-book links

## Decisions (resolved)

| Axis | Decision | Why |
|---|---|---|
| Granularity | Chapter/section (spine href) | Robust, deterministic, matches the stated use case |
| Source of truth | Derived from inline citations (no schema change) | One source of truth; links can't drift; cheapest |
| Explainer types | Inject manifest into book + section + passage | Uniform; follow-up turns (the primary surface) cite everywhere |
| Panel home | Collapsible strip in sidebar ThreadView + wider pane in pop-out modal | Sidebar is narrow; modal has room |
| Ordering/dedup | Dedupe by href, order by spine reading order | Panel doubles as "how far this discussion reaches" |

## Architecture

### The coordinate system (already exists)

The model currently receives the full book as **unsegmented plaintext**
(`book.txtPath`) with no chapter manifest, so it has no way to cite a
navigable target. We give it one — and the data already exists for free:

- `book.tocJson` (on `EpubFile`, read today by `prompt-builder.ts:127` for
  section titles) → `{label, href, subitems?}[]`
- `buildSpinePlaylist(spine, toc)` (`lib/reader/spine-playlist.ts:30`) already
  maps ToC labels → spine hrefs for TTS

A new `buildChapterIndex(book)` produces the manifest string from `tocJson`:
top-level ToC entries only (no `subitems` recursion), capped (~200 entries to
bound prompt size for pathological books), format:

```
[1] Chapter One → chapter1.xhtml
[2] Chapter Two → chapter2.xhtml
```

### Citation contract

- **Syntax:** `[<label>](#ch:<href>)` — a markdown link with the `#ch:` scheme.
  Models emit markdown fluently; no novel-token coaching.
- **Interception:** render-time regex matches **only** `#ch:` links. Any other
  markdown/URL renders as plain text (security: no arbitrary-link vector).
- **Validation:** the href is checked by basename against the loaded `spineItems`
  (matches `buildSpinePlaylist`'s convention). Invalid → degrades to plain
  label text, never a dead jump.
- **Resolution at the nav boundary:** the model emits bare basenames (the
  manifest emits basenames), but epub.js `rendition.display()` needs the full
  spine href on prefixed-spine EPUBs (`OEBPS/…`, `Text/…`) — `spine.get()` has
  only a `decodeURI` fallback, no basename match. So the reader resolves the
  citation basename → full spine href via `resolveToSpineHref` before calling
  `handleTocNavigate` (mirrors `resolveSpineHref`'s basename match applied to
  ToC hrefs at load).

### Data flow (life of a citation)

1. **Build** (`prompt-builder.ts`): `buildChapterIndex(book)` → passed as
   `chapter_index` into `fillTemplate` for book/section/passage. Each touched
   template's `version` is bumped.
2. **Generate**: the template instructs the model to cite as
   `[Chapter One](#ch:chapter1.xhtml)` when referencing a location. The
   citation is ordinary text, streamed and cached exactly as today. The cache
   key already folds in `promptVersion`, so the bump invalidates old rows
   naturally — no migration.
3. **Follow-ups**: `rebuildSystemPrompt` (`explainer-threads.ts:456`) rebuilds
   from the same templates, so follow-up answers cite too — the primary
   surface for "what chapter does the author describe X?"
4. **Render**: `MessageBubble` runs a parser over the string → matches become
   links calling `navigateTo`; non-matches stay plain text.
5. **Aggregate**: a `useMemo` over `initialContent + messages` extracts every
   citation → dedupes by href → orders by spine index → feeds the Links panel.
6. **Navigate**: link click → `onNavigateToHref(href)` → reused
   `handleTocNavigate` (`reader-client.tsx:535`). **Zero new navigation code** —
   the ToC already uses this exact path.

## Changes by file

| File | Change |
|---|---|
| `prisma/seed.ts` | Add `{{chapter_index}}` block + citation instructions to book/section/passage templates; bump their `version` |
| `src/server/services/prompt-builder.ts` | New `buildChapterIndex(book)` from `tocJson`; thread `chapter_index` into all three `fillTemplate` calls |
| `src/server/services/explainer-threads.ts` | No code change — `rebuildSystemPrompt` picks up the manifest automatically via prompt-builder |
| `src/lib/explainer/citations.ts` *(new, ~50 lines)* | Pure fns: `parseCitations`, `renderWithLinks`, `aggregateLinks`. The unit-testable core. |
| `src/components/explainer/explainer-threads-panel.tsx` | `MessageBubble` uses `renderWithLinks`; new `DiscussionLinksPanel` sub-component; `ThreadView` gains a collapsible Links strip (sidebar) / pane (modal) |
| `src/components/reader/reader-client.tsx` | Pass `onNavigateToHref={handleTocNavigate}` + `spineItems` into `ExplainerThreadsPanel` at the `:1500` mount |

## Edge cases

- **Hallucinated href** not in spine → strict validation degrades it to plain
  label text; never a dead jump.
- **Pre-bump cached explainer** (no citations) → no links, empty panel; degrades
  gracefully. No data migration.
- **Streaming partial markdown** (`[Chap…`) → regex won't match yet → shows
  raw briefly during stream; acceptable.
- **Pathological ToC (hundreds of entries)** → manifest cap prevents prompt
  bloat.
- **Modal open on click** → reader jumps behind the overlay; modal closes on
  jump so the reader is visible.

## Testing strategy

- **Vitest unit tests** on `src/lib/explainer/citations.ts` (pure functions):
  - `parseCitations`: hit, miss, multiple, none, `#ch:` only (non-`#ch:`
    ignored), invalid hrefs
  - `aggregateLinks`: dedup by href, ordering by spine index, multi-message
  - `renderWithLinks`: invalid href degrades to plain label
  - One `demo()`/`__main__` self-check per ponytail convention
- **Prompt compliance** is integration-level — manual spot-check across a few
  books; no reliable unit. The citation parser is the deterministic boundary.

## Cache cost

One-time regeneration per touched template on next access (book/section/passage
explainers re-generate once when next requested). Old rows render fine without
links until re-requested. No data migration, no schema change.
