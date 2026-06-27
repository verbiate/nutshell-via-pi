# Data Model

_Verified 2026-06-26 against `src/server/db/schema.prisma`._

Schema lives at **`src/server/db/schema.prisma`** (NON-DEFAULT path — Prisma CLI
needs `--schema=`). SQLite, so **no native enums**; `role` is a `String` with
app-level validation (`schema.prisma:10`).

> Always read the live `schema.prisma` for current columns. This is a map, not a
> substitute.

## The two-tier library split

```
EpubFile (md5 @unique)            ← Universal Library: one row per unique book
   │
   ├── UserBookAccess  @@unique([userId, bookId])   ← grants a user access
   │       └── User    ← sees only their access rows = "My Library"
   │
   ├── UserBookPosition @@unique([userId, bookId])  ← per-user reading spot
   ├── Bookmark        @@unique([userId, bookId, cfi])
   └── Highlight       @@unique([userId, bookId, cfi])
```

Two users reading the same title share the **same** `EpubFile` (and thus the
same cached AI output) but each has **their own** position/bookmarks/highlights.

## The two cache-key contracts (the whole cost strategy)

### Explainer cache
```
model Explainer {
  contentHash   String
  language      String   @default("en")
  contentType   String        // "book" | "section" | "passage"
  tier          String   @default("regular")
  content       String
  modelId       String
  promptVersion Int
  version       Int      @default(1)   // re-reroll writes version+1; lookup = max(version)
  ...
  @@unique([contentHash, language, contentType, tier, version])
  @@index([contentHash])
}
```
`contentHash = SHA-256(promptType + "\x00" + sourceText + "\x00" + String(promptVersion))`
— see `services/explainer.ts:40` (`computeContentHash`). Null-byte separators
prevent field-boundary collisions; `String()` coerces the prompt version.
**Language is NOT in the hash** — that's why it's a separate column: the same
source text in 13 languages shares one `contentHash` but yields 13 distinct
cache rows. `promptVersion` IS in the hash, so editing an admin `PromptTemplate`
(bump its version) invalidates exactly the affected entries. `tier` is
also a separate axis (not hashed) so Pro/Regular get independent rows. The
`version` column is the **regeneration axis**: a re-reroll writes a new row at
`version + 1` (same 4-axis key) instead of overwriting, so old versions survive
— lookups take `max(version)` for new requests, while `Discussion.explainerId`
pins the version each reader first saw (existing readers keep theirs, new
readers get latest).

### TTS audio cache
```
model TtsAudio {
  contentHash String
  language    String
  voiceId     String
  model       String
  provider    String
  storagePath String          // bytes live in storage adapter, NOT in DB
  duration    Float?
  ...
  @@unique([contentHash, language, voiceId, model])
  @@index([contentHash])
}
```
`contentHash = SHA-256(sourceText)` only — TTS has no prompt, so no
`promptVersion` (`services/tts.ts:40`, `computeTtsContentHash`). `language`
comes from the **book** (`book.language`, detected at upload), NOT user
preference (`tts.ts:167`). `voiceId`/`model` are separate axes so the same text
in multiple voices/models = multiple rows. Audio bytes are stored via the
storage adapter (`storage/local.ts`); only `storagePath` is in the row.

## All 23 models

### better-auth tables
- **`User`** — `id`, `email`, `role` (`regular|pro|admin`), `preferredLanguage`
  (default `"en"`), relations to everything.
- **`Session`** — `token @unique`, `expiresAt`, cascade-deletes with user.
- **`Account`** — OAuth provider link (Google), `providerId`, tokens.
- **`Verification`** — better-auth verification codes.

### Library / books
- **`EpubFile`** — Universal Library record. `md5 @unique`, `title`, `author?`,
  `language` (default `"und"`), `epubPath`/`txtPath`/`coverPath?`, `tocJson?`,
  `fileSize`, `totalParagraphs?`, `uploadedById`.
- **`BookMetadata`** — LLM-extracted canonical display metadata, 1:1 with
  `EpubFile` (`bookId @unique`): `title`/`subtitle?`/`description?`/`author?`/
  `authorGender?`/`isNarrative?` (null = LLM couldn't tell), `language?`,
  `promptVersion`, `model?`. `EpubFile` keeps the OPF originals so admins can
  revert any field.
- **`UserBookAccess`** — join table; `@@unique([userId, bookId])` makes upsert
  race-free.

### Reader state (all per-user)
- **`UserBookPosition`** — `paragraphIndex`, `charOffset`, `cfi?`,
  `tocSectionId?`; `@@unique([userId, bookId])`.
- **`Bookmark`** — `cfi`, `paragraphIndex`, `charOffset`, `selectedText?`,
  `note?`; `@@unique([userId, bookId, cfi])`.
- **`Highlight`** — `charOffsetStart`/`charOffsetEnd`, `selectedText`, `color`
  (default `#fbbf24`), `note?`; `@@unique([userId, bookId, cfi])`.
- **`PlaylistItem`** — TTS listen queue. `sectionHref`/`sectionLabel`/`position`,
  `status` (queue state, default `upcoming`), cached book display fields
  (`bookTitle?`/`bookAuthor?`/`bookCoverPath?`/`bookLanguage`), `playedAt?`;
  `@@unique([userId, position])`.

### AI / caching
- **`Explainer`** — cache table itself (see above).
- **`ExplainerRequest`** — provenance: who requested which explainer for which
  book + `passageCfi?`/`passageText?`/`sectionHref?`. `@@index([userId, bookId])`.
- **`Discussion`** — per-user multi-turn conversation about a book/passage/section
  that **rides on the Explainer cache**. The initial response is the shared cached
  `Explainer` (pinned via nullable `explainerId`); only follow-up turns are
  per-user (`DiscussionMessage`). `@@unique([userId, contentHash, language, tier])`
  is the **version-independent** key — re-asking the same context **reopens** the
  existing discussion instead of duplicating, while `explainerId` pins the version
  the reader first saw. `explainerId`/`contentHash` are nullable for blank "New
  discussion" threads (no explainer seed — opens with the user's own question) and
  legacy pre-backfill rows. `type` ∈ passage|section|book; `passageCfi?`/
  `passageText?`/`sectionHref?` capture the originating context (re-sent on
  follow-ups); `initialCacheHit?` is an admin UX flag. Renamed from
  `ExplainerThread` — "explainer" means ONLY the cached artifact, never the
  conversation. API `/api/discussions`, service `services/discussions.ts`.
- **`DiscussionMessage`** — follow-up turns only (the seeded response lives in the
  `Explainer`). `discussionId`, `role` (user|assistant), `content`, `modelId?`;
  `@@index([discussionId, createdAt])`. Renamed from `ExplainerMessage`.
- **`TtsAudio`** — audio cache (see above).
- **`TtsUsage`** — per-user monthly TTS generation counter,
  `@@unique([userId, periodKey])` where `periodKey` = `"YYYY-MM"`; `generations`
  resets each period.

### Admin / config / provenance
- **`PromptTemplate`** — `type @unique` (e.g. book-level, section-level),
  `content`, `version` (default 1). Admin-editable.
- **`OpenRouterConfig`** — per-`userType` (`@unique`) `apiKey?` + `model?`.
  Resolution in `services/openrouter.ts:26` (`getOpenRouterConfig`): **DB row
  wins, falls back to `process.env.OPENROUTER_API_KEY`, then `""`**. Model falls
  back to hardcoded defaults (`anthropic/claude-sonnet-4.6` for pro,
  `google/gemini-2.0-flash-001` for regular). So env is the default; `/admin/config`
  overrides per tier.
- **`TtsProviderConfig`** — per `(provider, userType)` `apiKey?` + `model?` +
  `voiceId?`; `@@unique([provider, userType])`.
- **`AppSetting`** — KV table for global admin-tunable settings (e.g.
  `globalSystemPrompt`, `bookTwoPassEnabled`). `key @id`, `value?`; add keys via
  `setSetting(key, value)` — no schema change needed.
- **`SystemError`** — admin-visible error log. `category` (e.g.
  `explainer_too_large`/`missing_api_key`/`openrouter_error`/`upload_blocked`),
  `message`, optional `userId?`/`bookId?`/`discussionId?`, `context?` (JSON),
  `resolved @default(false)`. Populated by explainer-pipeline + upload failures.
- **`AuditLog`** — append-only. `actorId`, `action`, `entityType`, `entityId`,
  `oldValue?`/`newValue?` (JSON snapshots), `createdAt`. Cascade rules: `actor`
  relation is non-cascading (logs survive user deletion attempts are blocked).

## Design notes worth knowing

- **Composite unique constraints enforce invariants at the DB level**
  (e.g. `@@unique([userId, bookId])`) so app code can upsert without
  check-and-insert race conditions.
- **Append-only audit with full old/new JSON** (not a diff) = replayable history
  at the cost of storage — deliberate, because provenance matters in a shared
  multi-reader system.
- **`totalParagraphs`** is computed at upload (Phase 6) and drives the reading
  progress indicator on bookshelf cards.
- **SQLite enums** — store roles/types as `String`; validate in app code.
- **Cascade** — `User`/`EpubFile` deletion cascades to most child rows
  (`onDelete: Cascade`); audit `actor` is the exception.
