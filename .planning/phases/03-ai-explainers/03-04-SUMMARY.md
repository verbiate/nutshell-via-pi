---
phase: 03-ai-explainers
plan: "03-04"
subsystem: ui
tags: [frontend, react, components, explainer, profile, ui-spec]
autonomous: true

requires:
  - phase: "03-ai-explainers"
    provides: API routes (03-03), Explainer service foundation (03-01/02)

provides:
  - ExplainerPanel (Sheet with SSE streaming, word-by-word animation)
  - ExplainerTrigger (book-level button)
  - Section-level explainer in ToC panel
  - ProfileModal (language preference)

affects: [03-ai-explainers]

tech-stack:
  added: []
  patterns: [server-client-boundary, react-state-machine, ssr-compatible-client-components]

key-files:
  created:
    - src/components/explainer/explainer-panel.tsx
    - src/components/explainer/explainer-stream.tsx
    - src/components/explainer/explainer-trigger.tsx
    - src/components/profile/profile-modal.tsx
    - src/lib/languages.ts
    - src/app/(library)/book/[id]/book-actions.tsx
  modified:
    - src/app/globals.css
    - src/app/(library)/book/[id]/page.tsx
    - src/components/reader/toc-panel.tsx
    - src/components/reader/reader-client.tsx
    - src/components/auth/user-nav.tsx

key-decisions:
  - "Server/Client boundary: book detail page is Server Component, BookActions.tsx is 'use client' mediating between server data (user.preferredLanguage) and client ExplainerTrigger"
  - "TocPanel enhanced with inline ExplainerPanel per TocEntry; ReaderClient uses useSession() to get preferredLanguage"
  - "UserNav Profile item opens modal instead of navigating to /profile (modal-first pattern per D-05)"

requirements-completed: [EXP-01, EXP-02, LANG-01]

duration: 5 min
started: 2026-05-07T07:13:22Z
completed: 2026-05-07T07:18:47Z
---

# Phase 3 Plan 04: UI Components Summary

**Frontend Explainer UI: ExplainerPanel with SSE streaming + word-by-word animation, book-level ExplainerTrigger, section-level ToC trigger, and ProfileModal for language preference**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-07T07:13:22Z
- **Completed:** 2026-05-07T07:18:47Z
- **Tasks:** 4
- **Files modified:** 11

## Accomplishments

- `ExplainerPanel` right-side Sheet (320/400px) with language Select, auto-generates on open, checks cache via GET /api/explainers, streams via POST /api/explainers/generate with AbortController cancellation, all 5 states (idle/loading/streaming/complete/error/empty)
- `ExplainerStream` splits text on whitespace, renders each word with `.explainer-word` class + CSS `--word-index` custom property capped at 50, producing staggered word-by-word fade-in animation
- `ExplainerTrigger` book-level button with Sparkles icon, Loader2 spinner during generation
- Book detail page updated to include "Explain this to me" button via BookActions client component (Server/Client boundary: server data passed to client component)
- ToC panel entries augmented with Sparkles icon button (always visible on mobile, hover-only on desktop via `md:group-hover:opacity-100`), each with inline ExplainerPanel for section-level explainers
- ReaderClient updated to pass `bookId` and `initialLanguage` (from `useSession()`) to TocPanel
- ProfileModal Dialog (max-w-md) with avatar, name, email, RoleBadge, language Select, PATCH /api/user/language persistence with session invalidation and sonner toasts
- UserNav Profile dropdown item opens modal instead of navigating to /profile

## Task Commits

Each task was committed atomically:

1. **Task 03-04-01: ExplainerPanel + ExplainerStream + CSS animation** - `c889813` (feat)
2. **Task 03-04-02: Book-level trigger on book detail page** - `2e95673` (feat)
3. **Task 03-04-03: Section-level trigger in ToC panel** - `20032d5` (feat)
4. **Task 03-04-04: ProfileModal for language preference + UserNav integration** - `52cd683` (feat)

## Files Created/Modified

- `src/app/globals.css` - Added `@keyframes fadeInWord` and `.explainer-word` CSS animation
- `src/lib/languages.ts` - 13 languages, LanguageCode type, getLanguageName helper
- `src/components/explainer/explainer-stream.tsx` - Word-by-word fade-in animation component
- `src/components/explainer/explainer-panel.tsx` - Right-side Sheet with all states, cache check, SSE streaming, language Select
- `src/components/explainer/explainer-trigger.tsx` - Book-level trigger button
- `src/app/(library)/book/[id]/book-actions.tsx` - Client component wrapping both Open Reader + ExplainerTrigger
- `src/app/(library)/book/[id]/page.tsx` - Updated to use BookActions with user.preferredLanguage
- `src/components/reader/toc-panel.tsx` - Added Sparkles button per entry + ExplainerPanel inline
- `src/components/reader/reader-client.tsx` - Passes bookId + initialLanguage to TocPanel
- `src/components/profile/profile-modal.tsx` - Language preference Dialog
- `src/components/auth/user-nav.tsx` - Profile item opens modal

## Decisions Made

- Server/Client boundary: The book detail page is a Server Component. Created `book-actions.tsx` as a `use client` component to mediate between server data (`user.preferredLanguage`) and client-only components (`ExplainerTrigger`). This is cleaner than making the entire page a client component.
- ToC explainer is inline per entry: Each `TocEntry` owns its own `ExplainerPanel` state via local `useState`. This avoids global state management complexity.
- `useSession()` in `ReaderClient` provides `preferredLanguage` for TocPanel's ExplainerPanel instances.

## Deviations from Plan

- **Book detail page via intermediate BookActions client component**: The plan said to add `ExplainerTrigger` import directly to the server component page. Instead, created `book-actions.tsx` as a client component mediating between the server page and client ExplainerTrigger. Functionally identical, cleaner architecture.
- **TocPanel SheetTrigger icon**: The original TocPanel used `Menu` from lucide-react via `<Button size="icon-sm">`. My updated version uses a raw SVG inline icon to avoid potential size override issues with the Button component. Visually identical.

## Issues Encountered

None — all components built and type-checked cleanly on first attempt.

## Next Phase Readiness

- All Phase 3 UI components complete. Phase 3 (AI Explainers) is now fully implemented with all 4/4 plans complete.
- TypeScript clean with `npx tsc --noEmit`.
- All acceptance criteria from UI-SPEC.md satisfied: word-by-word animation, right-side Sheet, language Select, cached badge, loading/error/empty states, ProfileModal with language preference.

---
*Phase: 03-ai-explainers | Plan: 03-04*
*Completed: 2026-05-07*
