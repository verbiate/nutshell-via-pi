# Plan: Verse-level (sub-chapter) playlist granularity

## Problem

For books whose EPUB ToC points many entries into shared XHTML files via
`#fragment` IDs (e.g. the Analects: 523 flat ToC entries, 499 with fragments,
into ~24 XHTML files), the playlist collapses to one entry per XHTML file.
`buildSpinePlaylist` keeps one label per spine item (the first ToC entry whose
basename matches), and `extractSectionText` then strips the `#fragment` and
returns the whole file's text. Result: the Analects plays Book-by-Book, not
verse-by-verse, and the playlist only shows ~24 rows.

Goal (per user): **every ToC leaf becomes its own playlist entry, and TTS reads
only that verse, then advances to the next verse.**

## Design

Two text-extraction paths (server-side Node + in-viewer iframe DOM) are kept in
sync: both bound their output to the fragment's element when a `#fragment` is
present. That single invariant makes the existing ENDED → auto-advance logic
do the right thing automatically — no special end-detection needed.

### No new dependencies

Stay consistent with the regex/scanner HTML-stripping pattern already in
`section-extractor.ts:139` and `epub-processor.ts`. The server-side fragment
extractor is a small tag-depth scanner, not a parser lib. `ponytail:` comment
on its known ceiling (malformed/unclosed tags → fall back to rest-of-document).

---

## Changes by file

### 1. `src/lib/reader/spine-playlist.ts` — leaf-level playlist

Replace the spine-walk with a ToC-leaf walk:

- Walk ToC depth-first (recurse `subitems`), in reading order.
- For each leaf, find its spine index via the existing basename map (so we can
  skip leaves whose href is outside the spine — rare bad nav points).
- Emit `{ href: leaf.href (fragment preserved), label: leaf.label, index }` for
  each leaf, grouped/sorted by spine index. Within a file, ToC order is the
  fragment order.
- For spine items with **no** ToC leaf (front matter, titlepage), emit one
  entry `{ href: spineHref, label: "", index }` at that spine index.
- Skip `linear === false` spine items (preserve current behavior).
- Dedup identical `href`s (some EPUBs repeat nav points).

The `(continued)` labeling disappears — every fragment is its own entry now.
Multi-file chapters (the old `part0005_split_*` case) still work: each split
gets the entries that resolve to its basename, no entry for splits with no
ToC leaf unless they're orphaned spine items.

### 2. `src/lib/reader/__tests__/spine-playlist.test.ts` — rewrite contract

- Replace the 3 existing tests with leaf-level equivalents:
  - multi-file chapter with one fragment per split → one entry each, no `(continued)`.
  - nonlinear spine items still skipped.
  - unnamed front matter still emits empty-label entries.
- Add an Analects-shape test: flat ToC, many fragments into one file → one
  entry per fragment, order preserved; plus an orphan-spine-entry case.

### 3. `src/server/services/section-extractor.ts` — fragment-aware extraction

- Split `sectionHref` into `path` + `fragment` (keep current `cleanHref` logic
  for the path).
- After loading the XHTML content, if `fragment` is present, extract the
  subtree using a new helper `extractElementByIdHtml(content, id)`:
  - Regex-locate the opening tag containing `\bid=["']<id>["']`.
  - Capture the tag name; scan forward tracking depth of that tag name
    (open vs close) until depth returns to 0.
  - Return the element's inner HTML.
  - `ponytail:` known ceiling — unclosed/malformed tags fall through to "rest
    of document after the open tag". If the id isn't found at all, fall back to
    the whole-file content (current behavior) and log a warning.
- Apply existing `stripHtml` / `htmlToTtsText` to the (possibly bounded) HTML.

### 4. `src/components/reader/epub-viewer.tsx` — `getSectionText(fragmentId?)`

Extend the imperative handle:
- `getSectionText: (fragmentId?: string) => string`.
- When `fragmentId` is provided, resolve `doc.getElementById(fragmentId)`; if
  found, clone that element and return `htmlToTtsText(clone.innerHTML)`.
  Otherwise fall back to the current whole-body behavior (with a `ponytail:`
  note that this means the fragment isn't in the rendered DOM yet — the caller
  should have navigated to it first).
- Update the `EpubViewerHandle` interface (line 395) accordingly.

### 5. `src/components/audio/audio-provider.tsx`

Three coordinated edits:

**a. `getText` (≈ line 520-560) — bound text to fragment.**
Parse the fragment off the incoming `href`. When a viewer is available and
belongs to the right book, call `viewer.getSectionText(fragment)` instead of
`viewer.getSectionText()`. Otherwise (off-reader / cross-book) the server path
already honors the fragment via change #3. Drop the `currentHref !== href`
short-circuit when a fragment is present (we no longer navigate away from a
file when the next entry shares the same basename — only the fragment
differs).

**b. `ttsSectionMatches` (line 276-283) — fragment-aware compare.**
- Strip query always.
- If both sides carry a `#fragment`, compare `basename(path) + "#" + fragment`.
- Otherwise fall back to the current basename compare.
This is what lets the active-section check distinguish verse 3 from verse 4
within the same file.

**c. `startSection` (line 638-667) + `advanceToNextSection` callers — drop
  startPos offset for fragment-hrefs.**
When the href has a fragment, the text is already bounded to the fragment, so
`getTtsStartOffset` is wrong (it would skip into the verse). In that case pass
`startPos: undefined` to the engine and let it start at chunk 0. Two callers
to update:
- `playSection` (line 1143/1167) — strip `startPos` to `undefined` when the
  href carries a fragment, **except** when the user explicitly clicked a
  within-verse CFI/selection (preserve `useVisible` / `startCfi`).
- Ghost/auto-advance paths (line 784, 865) already pass `undefined` — no
  change.

### 6. `src/components/reader/reader-panel.tsx`

The ToC entry play-menu (line 116-127) currently synthesizes
`startPos: { elementId: fragment }` from the href. With the new contract the
fragment lives in `sectionHref` itself and `playSection` derives it — so the
explicit `startPos` is redundant. Leave the explicit `startPos` for the
no-fragment case (whole-file) but drop it when a fragment is already in the
href. Keeps the click-to-play-within-verse CFI behavior intact.

---

## Ripple effects (verified, no code change needed)

- **Position percentage** (`audio-provider.ts:595`): `flatToc.length` is now
  leaf-level → percentage is finer-grained and more accurate. ✓
- **`bookFinished`**: the last `flatToc` entry is now the last verse, so
  end-of-book detection fires at the true end. ✓
- **TTS cache**: `contentHash = SHA-256(sourceText)` is per-source-text, so
  each verse becomes its own cache row automatically — correct sharing model,
  higher row count, no schema change.

## Known limitations (call out as follow-ups, don't block MVP)

- **Reader ToC "active" highlight** (`reader-panel.tsx:46`
  `item.href === currentHref`): the rendition's `rendered` event reports a
  basename-level `currentHref`, so within-file verse changes won't move the
  active bar. Fix later by having the viewer report the current fragment from
  CFI on `relocated`.
- **Cloud TTS seekRatio** (`audio-provider.ts:649-659`): the `getTtsStartOffset`
  → ratio math assumes whole-file text. For fragment entries, pass
  `seekRatio: 0` (start of fragment) when `startPos` is suppressed.

## Test plan

- `npm run test src/lib/reader/__tests__/spine-playlist.test.ts`
- New unit test for `extractElementByIdHtml` (small inline XHTML fixtures:
  nested same-name tags, missing id, single-quoted attr, id on `<span>` vs
  `<section>`).
- New unit test for the fragment-aware `ttsSectionMatches`.
- Manual: open the Analects, click "Play from the start", verify the playlist
  populates verse-level entries and auto-advances verse-by-verse; click an
  individual verse in the ToC and verify only that verse reads.

## Out of scope

- ToC active-highlight within a file (see Known limitations).
- A "play whole book" bulk-add action (doesn't exist today; verse-level entries
  emerge naturally from auto-advance).
- Any UI rework of the playlist drawer (it already renders arbitrary lengths;
  virtualization can be added later if 523 rows feels slow).

## Restart note

After editing `src/server/services/section-extractor.ts` (server code), no
Prisma change → no `db:generate` → no stale-client risk. But the dev server
should still be bounced once before manual verification so the new
`buildSpinePlaylist` ships to the client bundle:
`kill -9 $(lsof -ti:3000) && npm run dev`.
