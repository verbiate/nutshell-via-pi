# Phase 5: TTS Audio - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 05-tts-audio
**Areas discussed:** Audio player placement, Voice & tier differentiation, Generation feedback, TTS-08 deferral, Provider configuration, OpenRouter tiering

---

## Audio Player Placement & Controls

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Bottom bar (Spotify-style) | Fixed at bottom, always visible during playback, collapses when idle | ✓ |
| Slide-out Sheet panel | Consistent with ToC/Explainer/Search panels, less accessible during reading | |
| Reader chrome toolbar | Embedded in existing top bar, limited space for controls | |

**User's choice:** Bottom bar that slides up during active playback, collapses when not playing. "Start reading aloud" trigger placement is agent's discretion.
**Notes:** User wants controls to remain visible during playback. Trigger can be hidden by default or in chrome toolbar.

---

## Playback Interaction (Generation Feedback)

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Wait with feedback | Spinner on play button while generating, auto-play when ready, re-click cancels | ✓ |
| Queue and notify | Always return immediately, toast notification when ready | |

**User's choice:** Wait with feedback. Play button has spinner state; clicking again during spinner cancels the generation.
**Notes:** User explicitly wants cancellable spinner. Simple state machine: play → spinner (cancellable) → playing.

---

## Voice & Tier Differentiation

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Two tiers, no picker | Standard (Regular) vs Premium (Pro), auto-selected by book language | ✓ |
| Voice picker UI | Users choose from multiple voices | |
| Nuanced differentiation | Bitrate/prosody differences rather than different voices | |

**User's choice:** "Standard vs premium" only. No overcomplication for v1.
**Notes:** Voice auto-selected by book language (LANG-04). Admin controls which voice/model maps to each tier.

---

## TTS-08 (Full-book Download)

**User's choice:** Deferred. Not v1, not v2 — no version tag.
**Notes:** User explicitly said "this is a v3 feature, not a v1 feature!!!" — but corrected that no specific version should be tagged. Will be reconsidered when roadmap solidifies.

---

## TTS Provider Configuration (Admin Panel)

**User's choice:** Admin-configurable API keys per provider per user type:
- ElevenLabs keys × 3 (standard, pro, admin)
- fal.ai keys × 3 (standard, pro, admin)
- Admin assigns which TTS model/voice per user type per provider
**Notes:** Cost tracking by key segregation. Each account type has distinct keys and model availability.

---

## OpenRouter / Explainer Tiering (EXP-09)

**User's choice:** Admin-configurable OpenRouter API keys per user type (standard, pro, admin) with one LLM model selector per user type.
**Notes:** Replaces hardcoded `REGULAR_MODEL`/`PRO_MODEL` in openrouter.ts. Cost tracking per user type via key segregation. Ability to experiment with cheaper models on cheaper plans.

---

## Agent's Discretion

- Exact bottom bar design (height, controls layout, collapse/expand animation)
- "Start reading aloud" trigger placement and icon
- Section auto-advance behavior
- Scrubbing granularity and progress display
- Audio file format for caching
- Whether async queue infrastructure is needed
- Admin panel layout for API key + model configuration
- Missing API key handling
- Default fallback voice/model
- Player UI details (user will review and adjust once built)

## Deferred Ideas

- TTS-08 full-book audio download — no version tag, reconsider when roadmap solidifies
- Voice selection UI for users — future consideration
- Multiple voice options per tier — future enhancement
