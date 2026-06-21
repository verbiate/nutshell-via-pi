# Data Model

_Verified 2026-06-21 against `src/server/db/schema.prisma`._

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
  ...
  @@unique([contentHash, language, contentType, tier])
  @@index([contentHash])
}
```
`contentHash = SHA-256(promptType + "\x00" + sourceText + "\x00" + String(promptVersion))`
— see `services/explainer.ts:40` (`computeContentHash`). Null-byte separators
prevent field-boundary collisions; `String()` coerces the prompt version.
**Language is NOT in the hash** — that's why it's a separate column: the same
source text in 13 languages shares one `contentHash` but yields 13 distinct
cache rows. `promptVersion` IS in the hash, so editing an admin `PromptTemplate`
(and bumping its version) invalidates exactly the affected entries. `tier` is
also a separate axis (not hashed) so Pro/Regular get independent rows.

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

## All 16 models

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
- **`UserBookAccess`** — join table; `@@unique([userId, bookId])` makes upsert
  race-free.

### Reader state (all per-user)
- **`UserBookPosition`** — `paragraphIndex`, `charOffset`, `cfi?`,
  `tocSectionId?`; `@@unique([userId, bookId])`.
- **`Bookmark`** — `cfi`, `paragraphIndex`, `charOffset`, `selectedText?`,
  `note?`; `@@unique([userId, bookId, cfi])`.
- **`Highlight`** — `charOffsetStart`/`charOffsetEnd`, `selectedText`, `color`
  (default `#fbbf24`), `note?`; `@@unique([userId, bookId, cfi])`.

### AI / caching
- **`Explainer`** — cache table itself (see above).
- **`ExplainerRequest`** — provenance: who requested which explainer for which
  book + `passageCfi?`/`passageText?`/`sectionHref?`. `@@index([userId, bookId])`.
- **`TtsAudio`** — audio cache (see above).

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
