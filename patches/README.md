# patches/

Local patches applied via pnpm `patchedDependencies` (see `pnpm-workspace.yaml`).

## `@shadcn__react.patch`

**Applies to:** `@shadcn/react@0.1.0`, file `dist/message-scroller/index.js`.

**What it changes:** adds `&& h.current !== "anchored-to-message"` to the
mode-transition predicate inside the scroll-state sync callback. Without this,
any scroll that leaves the viewport not-at-end while the user is anchored to
a specific message (e.g. a pinned-question-during-follow-up-stream) silently
flips the mode back to `"following-bottom"`, dropping the anchor and jerking
the viewport to the live edge mid-stream.

**Why a patch instead of a wrapper:** the mode predicate lives inside the
bundle's internal `useCallback`, with no public hook to intercept. The
`MessageScroller` exports (`useMessageScroller`,
`useMessageScrollerScrollable`, `useMessageScrollerVisibility`) expose scroll
*actions* and *snapshots* but not the internal mode state, so a typed
consumer-side wrapper cannot reproduce the fix.

**Why a patch instead of vendoring:** the dist is one ~50 KB single-line
minified file. Vendoring would mean maintaining 50 KB of someone else's
minified code in this repo. The 9-line patch keeps the upgrade path open
(`pnpm update @shadcn/react`) while pinning the one behavioral fix this
project depends on.

**Upgrade hazard:** `@shadcn/react` is pre-1.0 (currently 0.1.0). Any version
bump requires re-applying this patch against the new bundle. The patch's
textual diff is one minified-token addition; pnpm will refuse the update if
the patched file no longer matches, so a failed `pnpm install` is the failure
mode (not silent drift). Re-derive the patch by:
1. `pnpm update @shadcn/react`
2. Find the predicate `s.current&&!i.end&&h.current!=="settling-jump"` in the
   new `node_modules/@shadcn/react/dist/message-scroller/index.js`
3. Append `&&h.current!=="anchored-to-message"`
4. `pnpm patch @shadcn/react@<new-version>` and commit the updated patch file.

**Upstream:** consider opening a PR to drop this patch entirely once the
`@shadcn/react` repo is public/stable.

## `@likecoin+epub-ts+0.6.3.patch`

See the diff in this directory for the specifics — pinned to `epub-ts@0.6.3`
for the same reason (small targeted fix to a third-party dep, easier to
maintain as a patch than a fork).
