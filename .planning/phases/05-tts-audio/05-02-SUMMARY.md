# Phase 5, Plan 02: API Routes Summary

**Committed:** 2026-05-07
**Wave:** 2 of 5
**Branch:** main

---

## Commits (4 total, one per task)

| # | Commit | Summary |
|---|--------|---------|
| 1 | `0b86222` | `feat(tts): add POST /api/tts/generate with cache-first TTS audio generation` |
| 2 | `e15ba29` | `feat(tts): add GET /api/tts/audio serving cached MP3/WAV files` |
| 3 | `067b76c` | `feat(admin): add GET+PATCH /api/admin/config for TTS and OpenRouter provider configuration` |
| 4 | `5419cde` | `test(tts): add unit tests for all three API routes` |

---

## What Was Built

### Task 1: POST /api/tts/generate
`src/app/api/tts/generate/route.ts` — 81 lines

- `requireAuth` + `verifyBookAccess(user.id, bookId)` gate before any generation
- Reads `bookId` and `sectionHref` from JSON body, returns 400 if either missing
- Derives `tier` from `user.role === "pro" ? "pro" : "regular"`
- Calls `generateTtsAudio({ bookId, sectionHref, tier, signal: request.signal })`
  — `request.signal` propagates AbortController cancellation to the TTS provider fetch
- Returns `{ audioId, url, cached }` — 503 when provider unconfigured, 401/403 for auth errors
- **Synchronous, not 202** — client shows spinner while POST is in flight (wait-with-feedback pattern,
  satisfying TTS-07 without async queue infrastructure)

### Task 2: GET /api/tts/audio
`src/app/api/tts/audio/route.ts` — 67 lines

- Reads `id` and `bookId` from URL search params, 400 if either missing
- `requireAuth` + `verifyBookAccess` gate before serving
- Looks up `TtsAudio` by `id` from DB, returns 404 if not found
- Serves raw bytes from `storage.read(audio.storagePath)` via `new Response(buffer, ...)`
- `Content-Type: audio/mpeg` for ElevenLabs and non-WAV fal output
- `Content-Type: audio/wav` only when `provider === "fal" && model.includes("wav")`
- Immutable cache control: `public, max-age=31536000`

### Task 3: Admin Config API Routes
`src/app/api/admin/config/route.ts` — 175 lines

**GET handler:**
- `requireAdmin` guard
- Validates `category` is one of `["openrouter", "elevenlabs", "fal"]`
- Returns `db.openRouterConfig.findMany()` for openrouter, `db.ttsProviderConfig.findMany({ where: { provider: category } })` otherwise

**PATCH handler:**
- `requireAdmin` guard
- Mask function: `val.length <= 12 ? "***" : val.slice(0,4) + "..." + val.slice(-4)`
- `category === "openrouter"`: `db.openRouterConfig.upsert` + `AuditLog(UPDATE_OPENROUTER_CONFIG)` with masked key
- `category !== "openrouter"`: `db.ttsProviderConfig.upsert` + `AuditLog(UPDATE_TTS_CONFIG)` with masked key

### Task 4: Unit Tests
22 tests across 3 files — all pass:

- `tts/generate/__tests__/route.test.ts` — 7 tests: 400 missing bookId/sectionHref, 403 no access, 200 cache hit, 200 cache miss (pro maps to tier: "pro"), 503 provider not configured, 401 unauthenticated
- `tts/audio/__tests__/route.test.ts` — 7 tests: 400 missing id/bookId, 403 no access, 404 not found, 200 audio/mpeg ElevenLabs, 200 audio/wav fal+wav, 200 audio/mpeg fal+non-wav
- `admin/config/__tests__/route.test.ts` — 8 tests: 401/403 auth, 400 invalid category, 200 GET openrouter/elevenlabs configs, 400 missing category, PATCH openrouter with masked key audit log, PATCH elevenlabs with masked key audit log

---

## Verification Results

| Criterion | Result |
|-----------|--------|
| `npm test` (full suite) | ✅ 100/100 tests pass |
| New test files pass | ✅ 22/22 tests pass |
| `POST /api/tts/generate` imports `generateTtsAudio` from `@/server/services/tts` | ✅ |
| `POST /api/tts/generate` passes `request.signal` to `generateTtsAudio` | ✅ |
| `POST /api/tts/generate` returns 503 for `"TTS provider not configured"` | ✅ |
| `POST /api/tts/generate` returns 400 for missing `bookId` or `sectionHref` | ✅ |
| `GET /api/tts/audio` reads `audioId` and `bookId` from search params | ✅ |
| `GET /api/tts/audio` calls `verifyBookAccess` before serving | ✅ |
| `GET /api/tts/audio` returns raw `Response` with correct `Content-Type` | ✅ |
| GET admin/config validates `category in ["openrouter","elevenlabs","fal"]` | ✅ |
| PATCH admin/config creates `AuditLog` with masked API key | ✅ |
| PATCH admin/config uses `db.openRouterConfig.upsert` for openrouter | ✅ |
| PATCH admin/config uses `db.ttsProviderConfig.upsert` for elevenlabs/fal | ✅ |

---

## Must-Have Criteria (from PLAN.md)

- [x] POST /api/tts/generate returns cached audio metadata instantly or generates, caches, and returns new audio
- [x] GET /api/tts/audio serves MP3 files with correct Content-Type and auth-gated access
- [x] GET /api/admin/config returns provider config rows per category
- [x] PATCH /api/admin/config upserts config with audit logging (masked API keys)
- [x] Unit tests cover all three route files with mocked services and auth

---

## Requirements Covered

| Requirement | Implementation |
|-------------|----------------|
| TTS-01 (TTS audio generation) | `POST /api/tts/generate` calls `generateTtsAudio`, returns `{ audioId, url, cached }` |
| TTS-02 (audio file serving) | `GET /api/tts/audio` serves stored MP3/WAV with correct Content-Type |
| TTS-04 (cache-first generation) | `generateTtsAudio` service already handles cache-first; route wraps it |
| TTS-05 (provider abstraction) | `GET/PATCH /api/admin/config` exposes admin configuration for ElevenLabs/fal/OpenRouter |
| TTS-07 (async UX via sync wait-with-feedback) | Synchronous POST with client-side spinner; cancellation via AbortSignal |
| EXP-09 (admin-configurable OpenRouter) | `GET/PATCH /api/admin/config` exposes `OpenRouterConfig` rows with masked key audit |

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Issues Encountered

None.

---

## Next Plan Readiness

Plan 05-03 (TTS Player UI: bottom bar, playback controls) is ready to execute next.

---

*Phase: 05-tts-audio | Plan: 05-02 | Duration: ~8 min | Completed: 2026-05-07*
