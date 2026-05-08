---
phase: 5
slug: 05-tts-audio
status: complete
shadcn_initialized: true
preset: slate
created: 2026-05-08
---

# Phase 5, Plan 03: UI Components Summary

**Committed:** 2026-05-08
**Wave:** 3 of 5
**Branch:** main

---

## Commits (6 total, one per task)

| # | Commit | Summary |
|---|--------|---------|
| 1 | `48eeee3` | `feat(05-03): add shadcn slider component for TTS progress scrubber` |
| 2 | `31224cb` | `feat(05-03): add TtsTrigger button and integrate into ReaderChrome right group` |
| 3 | `b2f3dce` | `feat(05-03): add useTtsPlayback hook with full state machine (IDLE→GENERATING→READY→PLAYING→ENDED)` |
| 4 | `731a737` | `feat(05-03): add TtsPlayer bottom bar with play/pause, progress scrubber, duration, and close` |
| 5 | `be7bcff` | `feat(05-03): integrate TTS playback into ReaderClient with TtsPlayer bar and conditional pb-16` |
| 6 | `4894494` | `feat(05-03): add admin config page at /admin/config with TTS/OpenRouter provider tabs per tier` |

---

## What Was Built

### Task 1: Slider Component
`npx shadcn add slider` installed the Radix-based slider component at `src/components/ui/slider.tsx`. Required for the TTS progress scrubber in the bottom bar.

### Task 2: TtsTrigger Component
`src/components/reader/tts-trigger.tsx` — stateless button with three visual states:
- **Idle**: `Volume2` icon, enabled, tooltip "Start reading aloud"
- **Generating**: `Loader2` spinning icon, enabled (re-click cancels), tooltip "Cancel audio generation"
- **Disabled**: `Volume2` icon, disabled, tooltip "Ask your admin to configure TTS"

`ReaderChromeProps` extended with `ttsTrigger?: ReactNode` slot. Placed in the right group between `searchTrigger` and `themeToggle`.

### Task 3: useTtsPlayback Hook
`src/hooks/use-tts-playback.ts` — 234 lines with full playback state machine:

- `TtsState = "IDLE" | "GENERATING" | "READY" | "PLAYING" | "ENDED"`
- `startSection(href, title)` — POSTs to `/api/tts/generate`, handles AbortController cancellation, pre-buffers next section (fire-and-forget)
- `togglePlayPause()` — play/pause audio element OR abort generation if GENERATING
- `scrub(time)` — seeks audio element to time
- `close()` — aborts, pauses, clears audio src, resets to IDLE
- Auto-advance: on `ended` event, looks up next TOC entry and calls `onNavigateToSection` + `startSection` after 500ms delay
- Flattened TOC helper (`flatToc()`) for sequential navigation through subitems

### Task 4: TtsPlayer Component
`src/components/reader/tts-player.tsx` — fixed bottom bar (`h-16`), slides up via `translate-y-0` / `translate-y-full` transition:
- Play/Pause/Loader2 button (same `size="icon-sm"` as chrome buttons)
- Section title label (truncated `max-w-[200px]` mobile, `max-w-[300px]` sm+)
- Progress scrubber (shadcn Slider, disabled during GENERATING)
- Duration display (`MM:SS / MM:SS`, hidden on mobile < sm)
- Close button with `X` icon

### Task 5: ReaderClient Integration
`src/components/reader/reader-client.tsx` updated:
- Added `TtsTrigger`, `TtsPlayer`, `useTtsPlayback`, `cn` imports
- Added `handleTtsNavigate` callback (mirrors `handleTocNavigate` but for TTS-initiated navigation)
- Added `useTtsPlayback` hook with `onNavigateToSection: handleTtsNavigate`
- Hidden `<audio ref={tts.audioRef} className="hidden" />` element outside the `isLoaded && !error` conditional
- `TtsPlayer` rendered outside the `isLoaded && !error` conditional so it persists independently
- Conditional `pb-16` on outer div when `tts.state.state !== "IDLE"`
- `ttsTrigger` prop passed to `ReaderChrome` with state mapping (GENERATING→"generating", IDLE→"idle", all others→"disabled")

### Task 6: Admin Config Page
`src/app/admin/config/page.tsx` — `/admin/config` page with:
- `Tabs` with three triggers: OpenRouter, ElevenLabs, fal.ai
- `ConfigRow` component per tier (regular/pro/admin) with per-field `Input` (password type for apiKey)
- GET: `fetch("/api/admin/config?category=...")` to load existing config
- PATCH: `fetch("/api/admin/config", { method: "PATCH" })` to save, invalidates React Query cache
- `Badge` shows "Unsaved" (default) / "Saved" (secondary) per card
- Toast "Configuration saved" on success
- Admin sidebar updated: `Key` icon + `{ label: "API Keys & Models", href: "/admin/config" }` added to `NAV_ITEMS`

---

## Verification Results

| Criterion | Result |
|-----------|--------|
| `npm test` (full suite) | ✅ 100/100 tests pass |
| `npx tsc --noEmit` on plan 05-03 files | ✅ No TypeScript errors in new files |
| `src/components/ui/slider.tsx` exists | ✅ |
| `src/components/reader/tts-trigger.tsx` exports `TtsTrigger` | ✅ |
| `src/components/reader/tts-trigger.tsx` imports `Volume2` and `Loader2` from `lucide-react` | ✅ |
| `ReaderChromeProps` has `ttsTrigger?: ReactNode` | ✅ |
| `ReaderChrome` renders `{ttsTrigger}` between `{searchTrigger}` and `{themeToggle}` | ✅ |
| `src/hooks/use-tts-playback.ts` exports `useTtsPlayback` | ✅ |
| `useTtsPlayback` returns `{ state, audioRef, startSection, togglePlayPause, scrub, close }` | ✅ |
| `startSection` POSTs to `/api/tts/generate` with `{ bookId, sectionHref }` | ✅ |
| `togglePlayPause` aborts fetch when state is `"GENERATING"` | ✅ |
| `useEffect` adds event listeners for `"play"`, `"timeupdate"`, `"loadedmetadata"`, `"ended"`, `"error"` | ✅ |
| `TtsPlayer` uses `cn` with `visible ? "translate-y-0" : "translate-y-full"` | ✅ |
| `TtsPlayer` renders `<Slider value={[state.currentTime]} max={state.duration || 100} />` | ✅ |
| `TtsPlayer` shows `Loader2 animate-spin` when `state.state === "GENERATING"` | ✅ |
| `TtsPlayer` shows `"Generating audio..."` during generation | ✅ |
| `TtsPlayer` has `role="region"` and `aria-label="Audio player"` | ✅ |
| `reader-client.tsx` imports `TtsTrigger`, `TtsPlayer`, `useTtsPlayback` | ✅ |
| `reader-client.tsx` renders `<audio ref={tts.audioRef} className="hidden" />` | ✅ |
| `reader-client.tsx` passes `ttsTrigger` prop to `<ReaderChrome>` | ✅ |
| `reader-client.tsx` renders `<TtsPlayer state={tts.state} ...>` | ✅ |
| `reader-client.tsx` conditionally applies `"pb-16"` when `tts.state.state !== "IDLE"` | ✅ |
| `reader-client.tsx` imports `cn` from `@/lib/utils` | ✅ |
| `src/app/admin/config/page.tsx` exists and exports default | ✅ |
| Admin config page renders `<Tabs defaultValue="openrouter">` with 3 triggers | ✅ |
| Admin config page renders `<ConfigRow>` for each of 3 tiers inside each tab | ✅ |
| Admin config page calls `fetch("/api/admin/config?category=...")` for GET | ✅ |
| Admin config page calls `fetch("/api/admin/config", { method: "PATCH" })` for save | ✅ |
| `admin-sidebar.tsx` imports `Key` from `lucide-react` | ✅ |
| `admin-sidebar.tsx` contains `{ label: "API Keys & Models", icon: Key, href: "/admin/config" }` in `NAV_ITEMS` | ✅ |

---

## Must-Have Criteria (from PLAN.md)

- [x] TtsTrigger appears in ReaderChrome right group between search and theme toggle
- [x] TtsPlayer bottom bar (h-16) slides up during playback with play/pause, section label, progress scrubber, duration, and close
- [x] useTtsPlayback hook manages the full playback state machine (IDLE → GENERATING → READY → PLAYING → ENDED)
- [x] ReaderClient auto-advances to next section on audio end and pre-buffers the following section
- [x] Admin config page at /admin/config has three tabs (OpenRouter, ElevenLabs, fal.ai) with per-tier cards

---

## Requirements Covered

| Requirement | Implementation |
|-------------|----------------|
| TTS-01 (TTS trigger) | `TtsTrigger` button in ReaderChrome toolbar with idle/generating/disabled states |
| TTS-02 (audio playback controls) | `TtsPlayer` bottom bar with play/pause, scrub, close, section label, duration |
| TTS-06 (tiered voices) | Admin config page exposes per-tier API key/model/voiceId for OpenRouter, ElevenLabs, fal.ai |
| LANG-04 (book language for TTS) | `useTtsPlayback` uses book-level TOC navigation; `generateTtsAudio` reads book language from DB |

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Issues Encountered

None.

---

## Next Plan Readiness

Plan 05-04 (Explainer history panel) is ready to execute next.

---

*Phase: 05-tts-audio | Plan: 05-03 | Duration: ~6 min | Completed: 2026-05-08*
