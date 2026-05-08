# Phase 5 Research: TTS Audio & EXP-09

**Goal:** Answer "What do I need to know to PLAN this phase well?"

---

## 1. Domain Research: TTS APIs

### 1.1 ElevenLabs

**Endpoint:** `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream`

- **Auth:** `xi-api-key` header.
- **Request body:** `{ text, model_id, voice_settings? }`
- **Response:** `audio/mpeg` byte stream (streaming endpoint) or blob (standard endpoint).
- **Key models:**
  - `eleven_multilingual_v2` — premium quality, 29 languages, ~5000 char max. Good for Pro tier.
  - `eleven_turbo_v2_5` — faster, cheaper, ~10000 char max. Good for Regular tier.
- **Voice IDs:** opaque strings (e.g. `21m00Tcm4TlvDq8ikWAM`). Admin pastes these into config. No API call needed to validate at config time; invalid IDs fail at generation time.
- **Max text length:** ~5000 chars for multilingual v2, ~10K for turbo v2.5. Section text can exceed this — **chunking required** for long sections.
- **Pricing:** per-character. Multilingual v2 ~$0.18/1K chars. Turbo v2.5 ~$0.10/1K chars.
- **Streaming:** The `/stream` endpoint returns audio bytes incrementally. For our use case (generate-then-cache), the standard endpoint is simpler — we get the full MP3 in one response.

**Chunking strategy for long text:**
- Split section text by paragraph into chunks under the model's char limit.
- Generate each chunk sequentially.
- Concatenate audio buffers into a single MP3 file before writing to storage.
- This is a known limitation; document it and handle gracefully (do not truncate user content).

### 1.2 fal.ai

**Endpoint:** `POST https://queue.fal.run/{model_id}`

- **Auth:** `Authorization: Key {api_key}` header.
- **Popular TTS models:**
  - `fal-ai/kokoro-tts` — fast, multilingual, cheap.
  - `fal-ai/playai-tts` — higher quality, voice selection via `voice` param.
- **Request body:** varies by model. For kokoro: `{ text, voice }`. For playai: `{ text, voice }`.
- **Response:** JSON with `audio.url` pointing to a temporary MP3/WAV file.
- **Key difference from ElevenLabs:** fal.ai returns a **URL to the generated file**, not raw bytes. We must **download the file from the URL** and save it to our storage provider for caching.
- **Pricing:** per-request, generally cheaper than ElevenLabs.
- **Async behavior:** fal's queue system can be async. For direct sync generation, use the `/run` endpoint (not `/queue`). The response is synchronous for most TTS models under ~30s.

### 1.3 Provider Comparison

| Aspect | ElevenLabs | fal.ai |
|--------|-----------|--------|
| Response format | Raw audio bytes | JSON with audio URL |
| Streaming support | Yes (native) | Limited |
| Voice selection | Voice ID string | Model-dependent param |
| Max text | 5K–10K chars | Model-dependent |
| Quality | Industry-leading | Good, improving |
| Cost | Higher | Lower |
| Languages | 29 | Model-dependent |

**Implication:** The TTS service layer must abstract both providers. ElevenLabs audio is written directly from the response body. fal.ai audio requires a second fetch to download the file from the returned URL.

---

## 2. Integration Patterns: Mirror the Explainer Cache-First Pattern

### 2.1 Established Pattern (from `src/server/services/explainer.ts`)

The Explainer service uses a clean three-step cache-first orchestrator:

1. `getExplainer({ contentHash, language, contentType, tier })` → cache lookup via composite unique index.
2. `generateExplainer(params)` → async generator that checks cache, streams on miss, accumulates, then writes cache.
3. `createExplainer(data)` → atomic `prisma.explainer.create({ data })`.
4. `computeContentHash(sourceText, promptVersion, type)` → SHA-256 hash for deduplication.

### 2.2 TTS Cache-First Pattern

Mirror this exactly, with audio-specific adaptations:

```
generateTtsAudio(params):
  1. Extract section text via existing extractSectionText()
  2. Compute content hash from section text (SHA-256)
  3. Look up TtsAudio by (contentHash, language, voiceId, model)
  4. CACHE HIT → return { cached: true, audioId, url }
  5. CACHE MISS →
     a. Determine provider, model, voiceId from admin config by user tier
     b. Chunk text if it exceeds provider limits
     c. Call provider API(s) to generate audio
     d. Concatenate chunks if needed
     e. Write audio buffer to storage: storage.write(`tts/{hash}.mp3`, buffer)
     f. Create TtsAudio row with storagePath
     g. Return { cached: false, audioId, url }
```

**Key differences from Explainer:**
- Output is binary (MP3), not text. The cache table stores metadata (path, size), not the audio itself.
- `computeContentHash` for TTS only needs the source text (no prompt version — TTS doesn't use prompts).
- No SSE streaming. Audio generation is a single blocking request per section (or sequential requests per chunk). The client shows a spinner during the POST.
- Cancellation matters: if the user clicks "cancel" during generation, we must abort the provider fetch to avoid burning API credits. Pass `AbortController.signal` through the fetch chain.

### 2.3 Reuse of Existing Assets

| Asset | How to Reuse |
|-------|-------------|
| `extractSectionText()` | Direct reuse — provides TTS input text per section. |
| `computeContentHash()` | Create TTS variant: `computeTtsContentHash(text)` using SHA-256 of raw text. |
| `storage.write()` / `storage.read()` | Store MP3 files. `LocalStorage` supports `Buffer` input. |
| `storage.getUrl()` | Returns `/api/files/{path}`. We can reuse this or create a dedicated audio route. |
| `requireAuth()` / `verifyBookAccess()` | Same auth guards for TTS endpoints. |
| `db` singleton | Same Prisma client for TtsAudio cache lookups. |
| `Explainer` model pattern | Copy composite unique index pattern: `@@unique([contentHash, language, voiceId, model])`. |

**Storage stream note:** `LocalStorage.write()` accepts `Buffer | string | NodeJS.ReadableStream`. The `fetch()` response in Next.js is a Web `ReadableStream`, not a Node.js stream. For audio, buffering into memory is acceptable — a 10-minute MP3 at 128kbps is ~10MB. Recommendation: `const buffer = Buffer.from(await response.arrayBuffer())` then `storage.write(path, buffer)`.

---

## 3. Schema Design

### 3.1 TtsAudio Model

Stores audio metadata. The actual MP3 lives in storage.

```prisma
model TtsAudio {
  id          String   @id @default(cuid())
  contentHash String
  language    String
  voiceId     String
  model       String   // full provider model ID
  provider    String   // "elevenlabs" | "fal"
  storagePath String   // relative path in storage provider
  fileSize    Int?     // bytes
  duration    Float?   // seconds, backfilled after first playback
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([contentHash, language, voiceId, model])
  @@index([contentHash])
}
```

**Rationale for fields:**
- `provider`: needed to know how the audio was generated (affects format, duration detection).
- `duration`: nullable because providers don't return duration. We can extract it client-side via `audio.duration` and PATCH the row later.
- `fileSize`: for admin cost analytics (future).
- No `bookId`: per D-11, cache is global by content. Adding `bookId` would fragment the cache. Access control is handled at the API layer (see Section 7).

### 3.2 Admin Configuration Tables

Use **typed tables** (not generic KV) for clarity and type safety. Three tables map directly to the admin UI tabs.

```prisma
model TtsProviderConfig {
  id        String   @id @default(cuid())
  provider  String   // "elevenlabs" | "fal"
  userType  String   // "regular" | "pro" | "admin"
  apiKey    String?  // provider API key
  model     String?  // provider model ID
  voiceId   String?  // voice identifier (provider-specific)
  updatedAt DateTime @updatedAt

  @@unique([provider, userType])
}

model OpenRouterConfig {
  id        String   @id @default(cuid())
  userType  String   // "regular" | "pro" | "admin"
  apiKey    String?  // OpenRouter API key
  model     String?  // LLM model ID, e.g. "google/gemini-2.0-flash-001"
  updatedAt DateTime @updatedAt

  @@unique([userType])
}
```

**Mapping to decisions:**
- D-07 (6 TTS key slots): `TtsProviderConfig` × 2 providers × 3 user types = 6 rows of `apiKey`.
- D-08 (model/voice per tier per provider): `model` + `voiceId` columns in `TtsProviderConfig`.
- D-09 (3 OpenRouter keys + 3 models): `OpenRouterConfig` × 3 user types = 3 rows of `apiKey` + `model`.
- D-10 (replace hardcoded models): `OpenRouterConfig.model` replaces `REGULAR_MODEL` / `PRO_MODEL` exports.

**Migration strategy:**
- Run `prisma migrate dev` to add the three new models.
- Seed default `OpenRouterConfig` rows with the current hardcoded values as defaults (`google/gemini-2.0-flash-001` for regular, `anthropic/claude-sonnet-4.6` for pro) so existing functionality doesn't break.
- TTS configs start empty — admin must configure before TTS is available.

### 3.3 Admin Config — Seed Defaults

```typescript
// prisma/seed.ts or migration
await db.openRouterConfig.createMany({
  data: [
    { userType: "regular", apiKey: process.env.OPENROUTER_API_KEY || null, model: "google/gemini-2.0-flash-001" },
    { userType: "pro", apiKey: process.env.OPENROUTER_API_KEY || null, model: "anthropic/claude-sonnet-4.6" },
    { userType: "admin", apiKey: process.env.OPENROUTER_API_KEY || null, model: "anthropic/claude-sonnet-4.6" },
  ],
  skipDuplicates: true,
});
```

---

## 4. Audio Player Architecture

### 4.1 Bottom Bar Player (D-01)

A persistent bottom bar that slides up when audio is active, collapses when idle.

**Placement:** Inside `ReaderClient` or the reader layout, below the EPUB viewer. CSS: `fixed bottom-0` or `absolute bottom-0` within the reader container, `transform translate-y-full` when idle, `translate-y-0` when playing.

**Height:** ~64–80px. Must not overlap EPUB content when collapsed. When expanded, the EPUB viewer should shrink (padding-bottom) so content remains readable.

**Controls (agent's discretion, v1):**
- Play / Pause button
- Progress scrubber (shadcn Slider)
- Current section label (truncated)
- Close / collapse button (returns to idle state)
- Optional: skip-to-next-section button

**State machine:**

```
IDLE → GENERATING → READY → PLAYING → ENDED → IDLE
  ↑                                    ↓
  └────────────────────────────────────┘ (auto-advance)
```

- **IDLE:** No audio activity. Bar is hidden/collapsed.
- **GENERATING:** User clicked play. POST to `/api/tts/generate` in flight. Play button shows spinner. Re-click cancels (AbortController abort).
- **READY:** Audio URL received. Auto-play begins (`audio.play()`).
- **PLAYING:** Audio is playing. Progress bar updates via `timeupdate` events.
- **ENDED:** Section finished. Auto-advance to next section (fetch next audio, play when ready).

### 4.2 HTML5 Audio API Integration

Use a hidden `<audio>` element controlled via React ref:

```typescript
const audioRef = useRef<HTMLAudioElement>(null);
```

**Key events:**
- `loadedmetadata` → set `duration` state, optionally PATCH `TtsAudio.duration` via API.
- `timeupdate` → update progress bar (`currentTime / duration`).
- `ended` → trigger section auto-advance.
- `error` → show toast, return to IDLE.
- `play` / `pause` → sync UI play/pause button.

**Audio source:**
```typescript
audioRef.current.src = `/api/tts/audio?id=${audioId}&bookId=${bookId}`;
```

### 4.3 Section Auto-Advance (TTS-01)

When playback of section N ends:
1. Look up section N+1 from the ToC / spine order.
2. If N+1 exists:
   a. Immediately POST to `/api/tts/generate` for N+1 (it may already be cached from pre-buffering).
   b. Show brief "Loading next section..." in the bar.
   c. When ready, set `audio.src` and `audio.play()`.
   d. **Sync reader view:** call the existing `navigateTo(sectionHref)` on the EPUB rendition so the text scrolls to match the audio.
3. If no next section, return to IDLE.

**Pre-buffering:** When playback starts for section N, fire-and-forget a `fetch()` to `/api/tts/generate` for section N+1. Since audio is cached globally, this warms the cache so N+1 is ready when needed.

### 4.4 Component Breakdown

| Component | Responsibility |
|-----------|---------------|
| `TtsPlayer` | Bottom bar UI, audio element ref, playback state machine, progress/scrubbing. |
| `TtsTrigger` | Toolbar button in `ReaderChrome` slot. Initiates playback for current section. |
| `useTtsPlayback` | Shared hook: manages audio ref, events, section queue, pre-buffering logic. |
| `AudioProgress` | Thin wrapper around shadcn Slider for scrubbing. |

**Slot integration (D-02):**
Add `ttsTrigger?: ReactNode` to `ReaderChromeProps` and place it in the right group (next to search/theme). The trigger is a simple button that calls `onStartTts(currentSectionHref)`.

---

## 5. Admin Panel Extension

### 5.1 Navigation

Extend `src/components/admin/admin-sidebar.tsx` NAV_ITEMS:

```typescript
{ label: "API Keys & Models", icon: Key, href: "/admin/config" },
// or separate pages:
{ label: "TTS Config", icon: Volume2, href: "/admin/tts" },
{ label: "AI Models", icon: Brain, href: "/admin/ai-models" },
```

**Recommendation:** A single `/admin/config` page with three tabs is cleaner than two separate pages. The admin can see all API configuration in one place.

### 5.2 Page Structure: `/admin/config`

Use shadcn Tabs:
- **Tab: OpenRouter** — 3 rows (Regular, Pro, Admin). Columns: API Key (password input), Model ID (text input).
- **Tab: ElevenLabs** — 3 rows. Columns: API Key, Model ID, Voice ID.
- **Tab: fal.ai** — 3 rows. Columns: API Key, Model ID, Voice ID.

Each row is a card or table row with Save button per row (or one global Save). Per-row saves are simpler and map well to `PATCH /api/admin/config/:category/:userType`.

### 5.3 API Routes

```
GET  /api/admin/config?category=openrouter|elevenlabs|fal
PATCH /api/admin/config
  Body: { category, userType, apiKey?, model?, voiceId? }
```

**Implementation notes:**
- Guard with `requireAdmin()`.
- Upsert the config row (`prisma.ttsProviderConfig.upsert` / `prisma.openRouterConfig.upsert`).
- **Audit log:** Every PATCH creates an `AuditLog` entry (ADM-06) recording old/new values. Do NOT log the full API key — log a masked version like `sk-...abcd`.

### 5.4 Default / Fallback Handling

If admin has not configured a tier:
- TTS: Show "TTS not configured" UI state. Hide play button or show disabled button with tooltip. The generation endpoint returns 503 with message "TTS provider not configured for your tier."
- OpenRouter: Fall back to env `OPENROUTER_API_KEY` and hardcoded defaults (`google/gemini-2.0-flash-001` / `anthropic/claude-sonnet-4.6`). This ensures Explainers keep working during the transition.

---

## 6. EXP-09 Implementation: Refactor OpenRouter from Hardcoded to Admin-Configurable

### 6.1 Current State

`src/server/services/openrouter.ts` exports:
- `REGULAR_MODEL = "google/gemini-2.0-flash-001"`
- `PRO_MODEL = "anthropic/claude-sonnet-4.6"`
- `streamExplainer()` reads `process.env.OPENROUTER_API_KEY` internally.

### 6.2 Target State

**Step 1:** Modify `streamExplainer` to accept `apiKey` and `model` as required parameters instead of reading env/hardcoded values.

```typescript
export interface StreamExplainerOptions {
  prompt: string;
  apiKey: string;      // NEW
  model: string;       // NEW
  temperature?: number;
  maxTokens?: number;
}
```

**Step 2:** Create `getOpenRouterConfig(userType)` service function.

```typescript
async function getOpenRouterConfig(userType: string) {
  const config = await db.openRouterConfig.findUnique({ where: { userType } });
  return {
    apiKey: config?.apiKey || process.env.OPENROUTER_API_KEY || "",
    model: config?.model || (userType === "pro" ? "anthropic/claude-sonnet-4.6" : "google/gemini-2.0-flash-001"),
  };
}
```

**Step 3:** Modify `generateExplainer` to fetch config by tier.

```typescript
const { apiKey, model } = await getOpenRouterConfig(tier);
if (!apiKey) throw new OpenRouterError("OpenRouter API key not configured", 500);

for await (const chunk of streamExplainer({ prompt: promptData.prompt, apiKey, model, maxTokens })) {
  // ...
}
```

**Step 4:** Remove `REGULAR_MODEL` / `PRO_MODEL` exports from `openrouter.ts`. Update any direct imports of these constants to use `getOpenRouterConfig()` instead.

**Step 5:** Seed `OpenRouterConfig` rows in migration/seed so existing behavior is preserved.

### 6.3 Backward Compatibility

- Env var `OPENROUTER_API_KEY` remains the fallback if DB config is empty.
- Hardcoded model strings remain the fallback if DB `model` is null.
- No breaking change to existing Explainer functionality.

---

## 7. Potential Pitfalls and Edge Cases

### 7.1 Text Length Limits (Critical)

ElevenLabs has a ~5000 character limit per request (10K for turbo). EPUB sections can easily exceed this. **If unhandled, generation will fail with a 400 error.**

**Mitigation:** Implement chunking in the TTS service. Split by paragraph boundary into chunks under the limit. Generate each chunk sequentially. Concatenate the resulting MP3 buffers using a library like `mp3-concat` or simply write chunks as separate files and serve them sequentially. For v1, concatenating buffers into a single file is the simplest user experience.

**Recommendation:** Create a `chunkText(text: string, maxChars: number): string[]` utility.

### 7.2 fal.ai Response Handling

fal.ai returns a JSON payload with a temporary URL, not audio bytes. The URL may expire. We **must** download the file immediately and save it to our storage provider.

**Pitfall:** If we only store the fal.ai URL in our cache, the audio will break when the URL expires (typically hours to days).

**Mitigation:** After receiving the fal.ai response, `fetch(audioUrl)` → `Buffer.from(await res.arrayBuffer())` → `storage.write(path, buffer)`. The `TtsAudio` row stores our storage path, not the fal.ai URL.

### 7.3 Concurrent Generation Race Condition

Two users request the same uncached section simultaneously. Both check cache, both miss, both generate audio, both write to storage. One insert succeeds (unique constraint), the other fails with unique violation.

**Mitigation:** Wrap cache-write in `try/catch`. On unique violation (`P2002`), swallow the error and return the existing `TtsAudio` row. This mirrors the Explainer pattern. The storage file may be written twice (harmless overwrite of identical content).

### 7.4 Audio Access Control (Security)

`TtsAudio` is global by content (D-11). The audio endpoint `/api/tts/audio?id={id}&bookId={bookId}` verifies the user has access to `bookId`, but the cached audio may have been originally generated for a different book.

**Risk:** A user with access to Book A could share an audio URL. Another user with access to Book B could substitute their own `bookId` (which they have access to) and listen to audio from Book A.

**Assessment:** For v1, this is an accepted leak. The `ttsAudioId` is an opaque CUID, making discovery infeasible. To tighten in v2, add a `UserTtsAudioAccess` junction table or include `bookId` in the cache key.

### 7.5 Cancellation and API Costs

If a user clicks "play" then immediately cancels during generation, the provider may still charge for the request.

**Mitigation:** Pass `request.signal` (from the incoming HTTP request) to the `fetch()` call to the TTS provider. When the client aborts, Next.js should propagate the abort signal, cancelling the upstream request before significant processing occurs. Test this explicitly — signal propagation in Next.js App Router can be unreliable across async boundaries.

**Fallback:** If signal propagation fails, accept the cost. TTS costs are per-character; cancelling mid-request may still incur partial charges depending on provider behavior.

### 7.6 Missing Admin Configuration

If admin has not set TTS keys for a tier, the play button should be disabled or hidden.

**Mitigation:** The `POST /api/tts/generate` endpoint checks for provider config before generation. If missing, returns 503 with `{ error: "TTS not configured" }`. The client shows a tooltip: "Audio generation is not yet configured." Optionally, the reader chrome can fetch config status on mount and conditionally render the TTS trigger.

### 7.7 Audio Format Compatibility

ElevenLabs returns MP3. fal.ai may return MP3 or WAV depending on model.

**Mitigation:** Store the `provider` in `TtsAudio` and set `Content-Type` correctly when serving: `audio/mpeg` for ElevenLabs, `audio/wav` or `audio/mpeg` for fal.ai based on provider. MP3 is universally supported by `<audio>` elements. If fal.ai returns WAV, it also works in all modern browsers.

### 7.8 Storage Path Collisions

Audio files are stored by content hash. If two providers generate audio for the same content with different voices, the `contentHash` is the same but `voiceId` differs, so unique constraint allows separate rows. Storage paths must include `voiceId` to avoid overwriting:

```
tts/{contentHash}/{voiceId}_{model}.mp3
```

### 7.9 Duration Detection

Providers do not return audio duration. We need it for the progress bar.

**Mitigation:**
- Client-side: `audio.duration` after `loadedmetadata` event gives duration.
- Server-side: Not available without parsing the MP3 (overkill for v1).
- Update `TtsAudio.duration` lazily: when the client loads audio and detects duration, fire a `PATCH /api/tts/audio/:id/duration` with `{ duration }`. This is fire-and-forget; failures are acceptable.

### 7.10 Language Detection vs. TTS Language (LANG-04)

LANG-04 says TTS voice respects **book language**, not user preference. The admin configures voices per language per tier per provider. But what if the admin hasn't configured a voice for a specific language?

**Mitigation:** Each provider config row should include `language` too, OR the voice ID itself implies language (ElevenLabs voices are mostly multilingual). For v1, assume admin configures a small set of default voices. If no language-specific voice is found, fall back to the configured default voice for that tier. Document that admins should configure multilingual voices (e.g., ElevenLabs `eleven_multilingual_v2` voices work across 29 languages).

**Revised schema thought:** `TtsProviderConfig` may need a `language` column if admins want different voices for different languages. But D-06 says "Voice/model per tier is configured by Admin" — it doesn't explicitly mention language. For simplicity, v1 uses one voice per tier per provider. The voice should be a multilingual voice. Future versions can add `language` to the config key.

### 7.11 Cost Explosion

TTS is expensive at scale. A 300-page book (~300 sections × 3000 chars = 900K chars) costs ~$90–$160 to fully generate at ElevenLabs premium rates.

**Mitigation:** Not a technical concern for v1, but worth noting. The cache-first architecture (TTS-04) prevents re-generation. Pre-buffering only generates the next section, not the whole book. TTS-08 (full-book download) is deferred partly for this reason.

### 7.12 Next.js fetch() and ReadableStream

`fetch()` in Next.js returns a Web `ReadableStream`. `LocalStorage.write()` expects a Node.js `ReadableStream` for stream input.

**Pitfall:** Passing a Web stream to `LocalStorage.write()` will crash because `.pipe()` is undefined.

**Mitigation:** Always buffer audio responses: `Buffer.from(await response.arrayBuffer())`. Audio sections are small enough for memory buffering.

### 7.13 OpenRouter Migration Safety

Moving from env-based keys to DB-based keys risks breaking existing Explainer functionality if the migration or seed fails.

**Mitigation:**
- Keep `process.env.OPENROUTER_API_KEY` as the ultimate fallback.
- Seed defaults in migration.
- Run existing Explainer tests after the refactor to confirm no regression.

---

## RESEARCH COMPLETE
