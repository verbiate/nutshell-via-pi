# Architecture

## Layers (from the knowledge graph `layers[]`)

| Layer | Where | Role |
|---|---|---|
| **API** | `src/app/api/**` | Next.js route handlers (REST endpoints) |
| **UI** | `src/app/(groups)`, `src/components/**`, `src/hooks/` | React components, pages, client hooks |
| **Service** | `src/server/services/**` | **All server-side business logic** — the heart of the backend |
| **Data** | `src/server/db/**`, migrations | Prisma client, schema, SQL migrations |
| **Auth & Middleware** | `src/lib/auth*.ts`, `src/middleware.ts` | better-auth wiring + RBAC guards |
| **Utility** | `src/types/`, `src/lib/`, `src/lib/reader/` | Cross-cutting helpers, domain types |
| **Storage** | `src/server/storage/**` | Pluggable asset adapter (local FS) |
| **Test** | `**/__tests__/`, `e2e/` | Vitest unit/integration + Playwright E2E |

**Convention:** route handlers stay thin; services do the work. Every new
protected handler must call `requireAuth` / `requireAdmin` first.

## Request & auth path

```
browser
  │
  ▼
middleware.ts (edge runtime, NO Prisma)
  │  checks `better-auth.session_token` cookie
  │  redirects /my-library /book/* /admin/* → /login if missing
  │
  ▼
app/api/**/route.ts (node runtime, Prisma OK)
  │  requireAuth() | requireAdmin()   ← src/lib/auth-guards.ts
  │  full user + role resolution
  │
  ▼
services/*.ts        ← business logic + caching + provider calls
  │
  ▼
db (Prisma) + storage adapter
```

- `requireAuth` / `requireAdmin` (`src/lib/auth-guards.ts`) is the **most-depended-upon
  file (42 fan-in)**. Always call it first in a protected handler.
- Auth wiring: `src/lib/auth.ts` (server config), `src/lib/auth-client.ts` (browser).
- Edge middleware can't resolve the user — it only checks the cookie exists.

## Service layer (`src/server/services/`) — responsibility table

| File | Responsibility |
|---|---|
| `epub-processor.ts` | Streams MD5 as bytes arrive (constant memory), parses OPF/ToC/text/cover, dedups vs. Universal Library |
| `library.ts` | Personal Library queries (with reading-progress join) |
| `explainer.ts` | Explainer cache CRUD + SHA-256 hashing + generation orchestration |
| `prompt-builder.ts` | Composes admin-managed `PromptTemplate`s with section/passage text, localized |
| `section-extractor.ts` | Pulls grounding text from the book's TXT conversion |
| `openrouter.ts` | SSE streaming client, per-tier model selection, `OpenRouterError` |
| `tts.ts` | TTS orchestration: chunk text, content-hash cache key, dispatch |
| `tts-providers.ts` | Standalone provider clients: `callElevenLabs()` + `callFalAi()`, each returning `Promise<Buffer>`. NOT a shared interface — dispatched by an if/else in `tts.ts`. Add a vendor = new `callX()` fn + add to `providers` array in `tts.ts` + dispatch branch + config row |
| `reader.ts` | Position / bookmark / highlight persistence (4th-most-depended file, 24 fan-in) |
| `admin.ts` | Paginated user mgmt + role changes; each writes an `AuditLog` row |
| `storage/local.ts` + `storage/types.ts` | Pluggable storage adapter (local FS now; S3-able via the interface) |

## Five key flows

### 1. Upload + MD5 dedup
`POST /api/books/upload` → `epub-processor.ts` → `library.ts`

Validate file → **stream MD5 incrementally** (constant memory via
`crypto.createHash('md5').update(chunk)`) → look up `EpubFile` by `md5`:
- **Hit**: create `UserBookAccess` linking uploader to existing book. Done.
- **Miss**: parse OPF/ToC/text/cover, store EPUB + TXT + cover, create `EpubFile`,
  grant access.

This is the heart of the Universal Library dedup.

### 2. Read + CFI position tracking
Route: `(reader)/book/[id]/reader` → `reader-client.tsx` (highest fan-out node)
→ `epub-viewer.tsx` (renders via `epub-ts`, emits CFIs)
→ `lib/reader/position-tracking.ts` (bridges CFI ↔ paragraph/char-offset tuple)
→ `reader.ts` (persists to `UserBookPosition`).

- Debounced 3s save, **CFI-first restore** (CFI survives font/viewport changes
  that byte offsets wouldn't).
- `paragraphIndex + charOffset` is the persisted bridge; `cfi` is source of truth.
- `reader-client.tsx` orchestrates viewer + position + all side panels
  (ToC, bookmarks, search, explainer, TTS).

### 3. Explainer — cache-first SSE streaming
`GET/POST /api/explainers` → `services/explainer.ts`

1. Compute `contentHash = SHA-256(promptType + sourceText + promptVersion)`
   (`explainer.ts:40`). Language & tier are NOT hashed — they're separate
   composite-key columns.
2. Check `Explainer` table by `(contentHash, language, contentType, tier)`.
3. **Hit** → serve cached instantly.
4. **Miss** → `prompt-builder.ts` composes the localized prompt (admin
   `PromptTemplate` + grounding text from `section-extractor.ts`)
   → `openrouter.ts` streams the response via SSE (key/model from
   `getOpenRouterConfig(tier)`: DB `OpenRouterConfig` → `OPENROUTER_API_KEY`
   env → hardcoded default model)
   → persist as an `Explainer` row
   → stream word-by-word into `explainer-stream.tsx`.

Next reader with access to that book never re-pays. Bumping an admin
`PromptTemplate`'s `version` invalidates exactly the affected entries
(`promptVersion` is part of the hash). Books over ~900K tokens are rejected
with a 400 (`explainer.ts:138`).

### 4. TTS — cache + multi-provider dispatch
`POST /api/tts/generate`, `GET /api/tts/audio` → `services/tts.ts`

Mirrors the Explainer cache pattern for audio. `tts.ts` extracts section text,
computes `contentHash = SHA-256(sourceText)` (`tts.ts:40`, no prompt), and uses
the book's language (`book.language`, not user pref):
- **Provider resolution** (`tts.ts:170`): tries `["elevenlabs", "fal"]` in
  order, picks the first with an `apiKey` configured for the tier in
  `TtsProviderConfig`.
- **Cache check** by `(contentHash, language, voiceId, model)`:
  - **Hit** → serve cached audio URL from storage.
  - **Miss** → chunk text at 5000 chars (`chunkText`), call the provider per
    chunk, concatenate, store via the storage adapter, record `TtsAudio`.
    Concurrent-miss races collapse via Prisma `P2002` (`tts.ts:253`).

`tts-player.tsx` plays cached audio with scrub controls.

**Provider clients** (`tts-providers.ts`) are two standalone functions, not a
shared interface:
```ts
callElevenLabs({ text, voiceId, modelId, apiKey, signal? }): Promise<Buffer>
callFalAi({ text, modelId, voiceId?, apiKey, signal? }): Promise<Buffer>  // fetches audio URL from JSON
```
Both return `Buffer`; dispatched by an `if (selectedProvider === "elevenlabs") … else …`
branch in `tts.ts:209`. **Adding a vendor = a new `callX()` fn + add to the
`providers` array + dispatch branch in `tts.ts` + a `TtsProviderConfig` row.**
The caching/chunking logic itself stays untouched.

### 5. Admin + audit trail
`/api/admin/*` → `services/admin.ts` (gated by `requireAdmin`).

Every mutation (role change, etc.) writes an `AuditLog` row: actor, action,
entity, and `oldValue`/`newValue` JSON snapshots (full replayable history, not
just a diff). `ExplainerRequest` follows the same provenance pattern (records
who requested what explainer without regenerating).

## Key fan-in / fan-out facts

- `src/lib/auth-guards.ts` — most-depended file (42 fan-in).
- `src/server/services/reader.ts` — 4th-most-depended (24 fan-in).
- `src/components/reader/reader-client.tsx` — highest fan-out (orchestrator).
