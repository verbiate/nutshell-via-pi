# Phase 5, Plan 01 Summary: Schema & Service Foundation

**Committed:** 2026-05-08
**Wave:** 1 of 5
**Branch:** main

---

## Commits (5 total, one per task)

| # | Commit | Summary |
|---|--------|---------|
| 1 | `19712b2` | `feat(db): add TtsAudio, TtsProviderConfig, OpenRouterConfig models` |
| 2 | `9d2ef9f` | `feat(services): add TTS service layer with cache-first orchestration` |
| 3 | `73d6cee` | `feat(services): add ElevenLabs and fal.ai TTS provider clients` |
| 4 | `9ddf30a` | `refactor(openrouter): admin-configurable API keys and models per tier (EXP-09)` |
| 5 | `3d88851` | `feat(seed): add OpenRouterConfig and TtsProviderConfig default rows` |

---

## What Was Built

### Prisma Schema (Task 1)
Three new models appended to `src/server/db/schema.prisma`:

- **`TtsAudio`** — audio metadata cache with composite unique key
  `@@unique([contentHash, language, voiceId, model])` + `@@index([contentHash])`
- **`TtsProviderConfig`** — per-(provider, userType) TTS API key, model, voiceId
  with `@@unique([provider, userType])`
- **`OpenRouterConfig`** — per-userType OpenRouter API key and LLM model
  with `userType @unique`

`npm run db:push` and `npm run db:generate` both succeeded.

### TTS Service Layer (Task 2)
`src/server/services/tts.ts` — 267 lines:

- `computeTtsContentHash(text)` — SHA-256 of raw text, verified: 64-char hex ✓
- `chunkText(text, maxChars)` — paragraph-first split, word-boundary fallback for
  overflow, verified: `chunkText("a\n\nb\n\nc", 5)` → `["a","b","c"]` ✓
- `getTtsAudio(params)` / `createTtsAudio(data)` — Prisma cache CRUD
- `getTtsProviderConfig(provider, userType)` — resolves provider config by tier
- `generateTtsAudio(params)` — cache-first orchestrator: extracts section text,
  computes hash, resolves provider (elevenlabs → fal priority), checks cache,
  generates per-chunk, concatenates buffers, stores to `tts/{hash}/{voiceId}_{model}.mp3`,
  writes cache entry with P2002 race condition handling

### TTS Provider Clients (Task 3)
`src/server/services/tts-providers.ts` — 89 lines:

- `callElevenLabs` — POST to `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream`
  with `xi-api-key` header, returns raw MP3 `Buffer`
- `callFalAi` — POST to `https://fal.run/{modelId}` with `Authorization: Key` header,
  parses `{ audio: { url } }`, fetches and returns audio `Buffer`
- Both accept `AbortSignal` for cancellation support

### OpenRouter Refactor EXP-09 (Task 4)
`src/server/services/openrouter.ts`:
- Removed `REGULAR_MODEL` and `PRO_MODEL` exports
- `StreamExplainerOptions` now requires `apiKey: string` and `model: string` (required, not optional)
- Added `getOpenRouterConfig(userType)` — reads `OpenRouterConfig` table, falls back to
  `process.env.OPENROUTER_API_KEY` and hardcoded defaults for backward compatibility
- `streamExplainer` uses `options.apiKey` and `options.model` directly

`src/server/services/explainer.ts`:
- `generateExplainer` calls `getOpenRouterConfig(tier)`, passes `{ apiKey, model }` to
  `streamExplainer` instead of using hardcoded constants

### Seed Data (Task 5)
`prisma/seed.ts` — new rows appended after PromptTemplate upserts:

- `OpenRouterConfig`: 3 rows (regular/pro/admin) with default model assignments,
  null apiKey (falls back to env var)
- `TtsProviderConfig`: 6 rows (elevenlabs/fal × regular/pro/admin) with all null —
  admin must configure before TTS is available

`npx prisma db seed` executed successfully.

---

## Verification Results

| Criterion | Result |
|-----------|--------|
| `npx prisma generate` with new types | ✅ Pass |
| Existing Explainer API tests | ✅ 78/78 tests pass |
| `computeTtsContentHash("hello")` → 64-char hex | ✅ `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824` |
| `chunkText("a\n\nb\n\nc", 5)` → `["a","b","c"]` | ✅ Pass |
| TypeScript compilation (`tsc --noEmit`) | ✅ No errors |

---

## Must-Have Criteria (from PLAN.md)

- [x] Prisma schema contains `TtsAudio` with `@@unique([contentHash, language, voiceId, model])`
- [x] Prisma schema contains `TtsProviderConfig` with `@@unique([provider, userType])`
- [x] Prisma schema contains `OpenRouterConfig` with `userType String @unique`
- [x] `npm run db:generate` exits 0
- [x] TTS service exports `computeTtsContentHash`, `chunkText`, `generateTtsAudio`
- [x] TTS service imports `extractSectionText` from `./section-extractor`
- [x] TTS service imports `callElevenLabs` and `callFalAi` from `./tts-providers`
- [x] TTS providers call correct endpoints with correct auth headers
- [x] `openrouter.ts` exports `getOpenRouterConfig`
- [x] `openrouter.ts` does NOT export `REGULAR_MODEL` or `PRO_MODEL`
- [x] `StreamExplainerOptions` requires `apiKey: string` and `model: string`
- [x] `explainer.ts` imports `getOpenRouterConfig` from `./openrouter`
- [x] `generateExplainer` calls `getOpenRouterConfig(tier)` and passes apiKey/model to `streamExplainer`
- [x] Seed contains `openRouterConfig.upsert` for regular/pro/admin
- [x] Seed contains `ttsProviderConfig.upsert` for both providers and all 3 user types
- [x] Seed uses `google/gemini-2.0-flash-001` for regular tier OpenRouterConfig
- [x] Seed uses `anthropic/claude-sonnet-4.6` for pro tier OpenRouterConfig

---

## Requirements Covered

| Requirement | Implementation |
|-------------|----------------|
| TTS-03 (audio caching) | `TtsAudio` model with composite unique key, cache-first `generateTtsAudio` |
| TTS-04 (cache-first generation) | `generateTtsAudio` with cache lookup before provider call, P2002 race handling |
| TTS-05 (provider abstraction) | `callElevenLabs` and `callFalAi` in `tts-providers.ts` |
| TTS-06 (tiered voices) | `getTtsProviderConfig` resolves by provider + userType |
| EXP-09 (admin-configurable OpenRouter) | `OpenRouterConfig` model + `getOpenRouterConfig()` + refactored `explainer.ts` |
| LANG-04 (book language for TTS) | `generateTtsAudio` reads `book.language` for TTS cache key |
