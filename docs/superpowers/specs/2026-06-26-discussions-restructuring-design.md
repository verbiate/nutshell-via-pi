# Discussions Restructuring — Design

**Date:** 2026-06-26
**Status:** Approved (slice A, delegated judgement)
**Scope:** Rename the user-facing "Explainers" concept to "Discussions"; make the cached initial response a versioned, admin-rerollable "Explainer"; elevate discussion context into a first-class, extensible area; fix the stale cache-hash lookups. One migration, one slice.

## Mental model (unchanged at the data level, reframed in vocabulary)

- **Discussion** = a per-user, multi-turn conversation (`ExplainerThread` + `ExplainerMessage`). Already exists; only the label changes.
- **Explainer** = the cached, no-user-input **first** generated response, shared across all readers (`Explainer` cache row). Already exists; gains **versioning** and **admin reroll**.

The existing model names already match this split, so **DB models are NOT renamed** — only user-facing strings.

## Net-new behavior

1. Rename tab + user-facing strings → "Discussions" (admin surfaces keep "Explainer" where it means the cached explainer).
2. **Versioned explainers:** a re-reroll creates a *new version* of a cache row. Existing discussions keep the version they first saw (`explainerId` already pins it); new discussions get the latest version.
3. **Admin affordances** in a discussion: badge the first message as `Explainer · v{n}`; chip `from cache` / `freshly generated`; "Regenerate explainer" action (creates a new version); "newer version available" indicator.
4. **Context area:** reframe `DiscussionLinksPanel` + passage preview into a "Context" section (Book always + originating passage/section with a deeplink). Passage deeplinks become **CFI-precise** (mirroring highlights), upgrading from today's section-level nav. Extensible layout; no attachments table built now.
5. **Hash single-source-of-truth fix:** the route-level cache lookups use a stale minimal hash that always misses for section/passage/two-pass. Centralize via one `resolveCacheKey` helper.

## Data model (`src/server/db/schema.prisma`)

### `Explainer` — add versioning
```prisma
+ version    Int      @default(1)
- @@unique([contentHash, language, contentType, tier])
+ @@unique([contentHash, language, contentType, tier, version])
```
The composite-unique index also serves the "latest version" query.

### `ExplainerThread` — context-based uniqueness + admin flag
```prisma
+ contentHash     String    // cache key, version-independent
+ initialCacheHit Boolean?
- @@unique([userId, explainerId])
+ @@unique([userId, contentHash, language, tier])
```
- `contentHash` makes the "one discussion per user per context" rule version-independent: re-asking the same context **reopens** the existing discussion instead of duplicating after a reroll.
- `explainerId` is retained — it pins the exact version this discussion displays.
- `initialCacheHit` persists the hit/fresh flag so admins can see it later (the server already knows it at creation time; it just wasn't stored).

### Migration / backfill
- `version` defaults to 1 → all existing rows become v1.
- `contentHash` is backfilled by copying from each thread's linked explainer:
  `UPDATE ExplainerThread SET contentHash = (SELECT contentHash FROM Explainer WHERE id = ExplainerThread.explainerId)`
- `initialCacheHit` backfills to `null` (unknown for legacy).

> After the schema edit: run `db:generate` + `db:push`, then **restart `npm run dev`** (stale-PrismaClient rule, AGENTS.md).

## Services

### `services/explainer.ts`
- Rename `getExplainer` → `getLatestExplainer`: `findFirst({ where:{contentHash,language,contentType,tier}, orderBy:{version:'desc'} })`.
- `createExplainer`: compute `version = (max existing for the 4-axis key) + 1` inside a transaction; P2002 → re-fetch latest + retry.
- Extract `resolveCacheKey(params)` = the single caller that computes `contentHash` (full formula: promptType, sourceText, bookMd5 for section/passage, promptVersion, twoPass + metadata salts). Both generation and every lookup call it. This is the root-cause fix for the hash-drift bug.

### `services/explainer-threads.ts`
- `streamInitialThreadResponse`: cache lookup via `getLatestExplainer`; persist `initialCacheHit`; thread upsert keyed on the new uniqueness `[userId, contentHash, language, tier]`. **Re-asking the same context reopens** the existing discussion (emits its pinned explainer) instead of duplicating.
- New `rerollExplainer(explainerId, actorId)`: recover source context from a linked thread/request (bookId, type, passageText/sectionHref, language, tier), regenerate with identical inputs, `createExplainer(version=max+1)`, write an `AuditLog` snapshot (old content → new content). Existing threads are untouched. Throws if no source context can be recovered (orphan cache row).
- `getThreadWithMessages`: also select `initialCacheHit`, `version`, and the `latestVersion` for the same cache key (so the UI can show "newer version available").

## API

- `POST /api/explainers/threads`: on an existing-thread hit (same user + context), emit `{type:"existing", threadId}` so the client opens the discussion without re-"generating".
- **NEW `POST /api/explainers/threads/[id]/reroll`** (admin-only, SSE): streams the regeneration, final `{type:"version", version, explainerId}`. Calls `rerollExplainer`.
- `DELETE /api/explainers/[id]` (admin purge): under versioning this deletes one version row. Threads pinned to it would cascade-delete — instead **reassign** them to the latest remaining version (safer; avoids losing user discussions). Reroll is the recommended tool; purge is the nuke.
- `GET /api/explainers/threads/[id]` + `/history`: include version fields.

## UI (`src/components/`)

### Rename (strings only)
- `reader/reader-tools.ts`: `bulb` label "Explainers" → "Discussions"; icon `lightbulb` → `messages-square`; description updated.
- Audit user-facing "Explainer" strings in `components/` → "Discussion". Keep "Explainer" in admin-only surfaces where it refers to the cached explainer concept. Code-level identifiers (`Explainer`, `explainer-threads-panel.tsx`) unchanged.

### Admin affordances in `ThreadView` (`explainer/explainer-threads-panel.tsx`, admin-only)
- First-message badge: `Explainer · v{n}`.
- Chip: `from cache` / `freshly generated` (from `initialCacheHit`).
- If `version < latestVersion`: "Newer version available (v{latest})".
- Thread `⋯` menu: "Regenerate explainer" → SSE stream → "v{n} now live for new discussions".

### Context area (reframe of `DiscussionLinksPanel` + passage preview)
- A "Context" section: **Book** (always) + originating **passage** (snippet + "View in book", CFI-precise via `onNavigateToCfi`, mirroring highlights) or **section** (name + link).
- Extensible layout — leaves visual room for a future "Add context" affordance. No attachments table built this slice.

### Regular users
First message renders as a normal assistant turn — no explainer jargon, no admin controls.

## Edge cases / testing (Vitest)

- `resolveCacheKey` is the single source of truth → a test that the lookup key equals the generation key for book / section / passage / two-pass / metadata.
- `getLatestExplainer` returns the highest version for a 4-axis key.
- `rerollExplainer` creates `version = max+1`; existing threads' `explainerId` is unchanged.
- Thread uniqueness `[userId, contentHash, language, tier]` prevents a duplicate discussion when the same context is re-asked (and after a reroll).
- `initialCacheHit` is persisted `true` on cache hit, `false` on fresh generation.
- Reroll with unrecoverable source context → throws (→ 422 in the route).
- Concurrent reroll → P2002 → retry yields `max+1` (no duplicate version).

## Deferred (explicitly out of scope)

- **Initial-prompt tuning** — the "fire off an initial prompt" refinement ("more on this later").
- **Multi-context attachments table** — other selections/sections, text attachments, other books (Pro). The schema (contentHash-based uniqueness, versioned explainers) leaves room; an attachments table is a follow-up slice.
- **"Upgrade this discussion to latest version" button** — optional future affordance; for now existing discussions stay on their pinned version.
