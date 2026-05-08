# Phase 5: TTS Audio - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can generate and listen to audiobook-style audio for books and sections via TTS providers (ElevenLabs and fal.ai). Audio is cached globally in the Universal Library by (content, language, voice, model). Regular users get standard voices; Pro users get premium voices. Admins configure API keys and model assignments per user type via the Admin Panel. Pro-tier Explainer model access (EXP-09) is also implemented here — admin-configurable OpenRouter keys and LLM models per user type. Full-book offline download (TTS-08) is deferred.

**Requirements:** EXP-09, TTS-01..07, LANG-04. TTS-08 is explicitly deferred (not v1).

</domain>

<decisions>
## Implementation Decisions

### Audio player placement & controls
- **D-01:** Bottom bar slides up from below when audio is actively playing; collapses away when idle so it doesn't eat reading space
- **D-02:** "Start reading aloud" trigger placement is agent's discretion — likely a chrome toolbar slot (consistent with existing slot-based pattern)

### Playback interaction
- **D-03:** Wait-with-feedback pattern: when user hits play on an ungenerated section, the play button shows a spinner. Re-clicking during spinner cancels the generation request. Audio auto-plays once ready.
- **D-04:** Player UI details (progress bar, scrubbing, section auto-advance, duration display) are agent's discretion. User will review and adjust once built.

### Voice & tier differentiation
- **D-05:** Two voice tiers only: standard (Regular) and premium (Pro). No voice picker UI for users. Voice is auto-selected by book language (LANG-04).
- **D-06:** Voice/model assignment per tier is controlled by the Admin via admin panel configuration — admin decides which TTS voice maps to which tier for each language.

### TTS provider configuration (Admin Panel)
- **D-07:** Admin Panel provides API key configuration for both TTS providers per user type:
  - ElevenLabs API key × 3 (standard, pro, admin)
  - fal.ai API key × 3 (standard, pro, admin)
  - Total: 6 TTS API key slots
  - Rationale: segregating keys by user type enables per-tier cost tracking and model experimentation
- **D-08:** Admin assigns which TTS model/voice is used for each user type, per provider. This determines quality and cost for each tier.

### OpenRouter / Explainer tiering (EXP-09)
- **D-09:** Admin Panel provides OpenRouter API key configuration per user type:
  - OpenRouter API key × 3 (standard, pro, admin)
  - Plus one LLM model selector per user type (admin picks which model each tier uses)
  - Total: 3 API key slots + 3 model selectors
  - Rationale: cost tracking per user type via key segregation; ability to experiment with cheaper models on cheaper plans
- **D-10:** This replaces the current hardcoded `REGULAR_MODEL` / `PRO_MODEL` in `src/server/services/openrouter.ts` with admin-configurable values from the database.

### Audio caching
- **D-11:** Audio cache key: `(contentHash, language, voiceId, model)` per TTS-04. Tier is implicitly encoded via the voiceId+model combination (since admin assigns those per tier).

### Async generation (TTS-07)
- **D-12:** Agent's discretion — given the wait-with-feedback pattern for section-by-section streaming (D-03), a full async job queue may not be needed for the streaming use case. A simple server-side generation + cache-write flow is likely sufficient. If latency warrants it, a lightweight queue can be added.

### TTS-08 (Full-book download)
- **D-13:** Explicitly deferred. Not v1, not v2 — no version tag assigned. This will be reconsidered when the roadmap is solidified.

### the agent's Discretion
- Exact bottom bar design (height, controls layout, collapse/expand animation)
- "Start reading aloud" trigger placement and icon
- Section auto-advance behavior (seamless vs gap vs manual next)
- Scrubbing granularity and progress display
- Loading/cancellation state visual design
- Audio file format for caching (MP3, WebM, etc.)
- Whether async queue infrastructure is needed beyond direct generation
- Admin panel layout for API key + model configuration screens
- How to handle missing API keys (graceful error vs hidden UI)
- Default fallback voice/model if admin hasn't configured a tier
- Whether to show "generating audio..." feedback inside the bottom bar or on the trigger button
- Section boundary detection for TTS input (reuse existing section text extraction from Phase 3)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Requirements
- `.planning/PROJECT.md` - Vision, core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` - EXP-09, TTS-01..08, LANG-04 requirements
- `.planning/ROADMAP.md` - Phase 5 goal, success criteria, research flags (TTS cost estimation, ElevenLabs vs fal.ai quality, async queue validation)

### Prior Phase Context
- `.planning/phases/03-ai-explainers/03-CONTEXT.md` - Explainer decisions: caching architecture (SHA-256 hash, composite unique index), SSE streaming, tiered model selection, cache-first orchestration pattern
- `.planning/phases/04-reading-enhancements/04-CONTEXT.md` - Reader enhancements: floating toolbar, search panel, CFI-based navigation patterns
- `.planning/phases/02-core-reading/02-CONTEXT.md` - Reader architecture: slot-based chrome toolbar, Sheet panels, full-screen immersive design
- `.planning/phases/02-core-reading/02-UI-SPEC.md` - Design system (slate preset, spacing, colors, typography)

### Code References
- `src/server/db/schema.prisma` - Current schema (needs `TtsAudio` model, admin config tables for API keys/models; `Explainer` model pattern for cache design reference)
- `src/server/services/openrouter.ts` - Current hardcoded `REGULAR_MODEL`/`PRO_MODEL` exports — must be replaced with admin-configurable values (D-10)
- `src/server/services/explainer.ts` - Cache-first orchestrator pattern (`generateExplainer` async generator) — TTS service should mirror this pattern
- `src/server/services/section-extractor.ts` - Section text extraction from EPUB spine — reuse for TTS input text
- `src/server/services/prompt-builder.ts` - Prompt construction pattern
- `src/components/reader/reader-chrome.tsx` - Slot-based chrome toolbar — integration point for audio trigger
- `src/components/reader/reader-client.tsx` - Reader orchestration component — where audio player state lives
- `src/components/reader/toc-panel.tsx` - Sheet panel pattern reference
- `src/app/api/explainers/route.ts` - API route pattern (cache check, generation, SSE streaming)
- `src/app/api/explainers/generate/route.ts` - SSE generation endpoint pattern
- `src/app/admin/` - Existing admin panel pages — extend for TTS/OpenRouter key configuration
- `src/server/db/index.ts` - Prisma client singleton

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/sheet.tsx` - shadcn Sheet (for any slide-out audio controls if needed)
- `src/components/ui/button.tsx` - Button with variants (play/pause/cancel states)
- `src/components/ui/slider.tsx` - shadcn Slider (for audio scrubbing/progress)
- `src/components/ui/skeleton.tsx` - Loading skeletons
- `src/components/ui/tabs.tsx` - Tabs component (admin panel voice/model config)
- `src/components/ui/badge.tsx` - Status badges (generating, cached, pro badge)
- `Explainer` model in schema.prisma - Cache table pattern with composite unique index `@@unique([contentHash, language, contentType, tier])`
- `computeContentHash()` from explainer service - SHA-256 hash pattern, reusable for TTS cache keys
- `generateExplainer` async generator - Cache-first stream-then-cache orchestrator pattern
- Section text extractor - Provides TTS input text per section
- `src/app/admin/` pages - Admin panel patterns (forms, tables, auth guards)

### Established Patterns
- Auth-gated API routes: `requireAuth()` + access verification before returning data
- Cache-first orchestration: check cache → generate if miss → write cache → serve
- Composite unique indexes for cache deduplication (Explainer pattern)
- TanStack Query for client-side data fetching
- `sonner` for toast notifications
- Slot-based ReaderChrome composition
- Admin panel with server-side role validation on every request
- Prisma upsert for atomic create-if-not-exists
- SSE streaming with `ReadableStream` and manual frame parsing (Explainer endpoint)
- TXT file at `txtPath` on `EpubFile` model — the source corpus for TTS input

### Integration Points
- Reader chrome toolbar slots — new "Read Aloud" trigger button
- Reader client component — audio player state management, playback lifecycle
- Section text extractor — provides input text for TTS generation per section
- Explainer cache pattern — TTS cache table mirrors `Explainer` model design
- Admin panel — new configuration screens for API keys + model assignments (3 providers × 3 user types)
- OpenRouter service — must be refactored from hardcoded models to admin-configurable keys/models
- Book detail page `/book/[id]` — potential location for section-level audio triggers outside the reader

</code_context>

<specifics>
## Specific Ideas

- Audio bottom bar should feel like a mini Spotify player — persistent during playback, unobtrusive when idle. User expects to keep reading while listening.
- Play button state machine: idle → generating (spinner, cancellable) → playing. Simple, no ambiguity.
- Two tiers, no picker — the system just gives you better audio if you're Pro. Users don't think about voices, they just hit play.
- Cost tracking is a first-class concern: segregating API keys by user type is the mechanism. Admin owns key management and model selection per tier.

</specifics>

<deferred>
## Deferred Ideas

- **TTS-08: Full-book audio download for offline listening** — deferred, no version tag. Will be reconsidered when roadmap is solidified.
- **Voice selection UI for users** — v1 uses auto-selected voice per book language; user voice picker is a future consideration.
- **Multiple voice options per tier** — v1 is strictly "standard vs premium" (two tiers, one voice each). Multi-voice per tier is a future enhancement.

</deferred>

---

*Phase: 05-tts-audio*
*Context gathered: 2026-05-08*
