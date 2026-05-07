# Phase 3: AI Explainers - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can request AI-generated Explainers (never called "summaries") at book and section levels. Explainers are generated via OpenRouter with user-specified language preference, grounded in the book's TXT conversion, and cached globally in the Universal Library by (content, language, type, tier) so they are generated once and served to all readers. Admin prompt templates are already editable (Phase 1). Passage-level Explainers, bookmarks, and highlights are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Explainer trigger & display
- **D-01:** Book-level "Explain this to me" trigger on the book detail page (`/book/[id]`), adjacent to the "Open Reader" button
- **D-02:** Section-level "Explain this to me" trigger on each ToC entry in the slide-out ToC panel (`src/components/reader/toc-panel.tsx`)
- **D-03:** Display container is **agent discretion** — slide-out panel (Sheet) is the consistent immersive pattern used for ToC, but modal or inline are acceptable if they feel better for reading long-form AI text
- **D-04:** Explainer text streams in with a **GSAP-style word-by-word fade-in animation** as tokens arrive from OpenRouter SSE — this is a signature UX moment, not a plain text stream

### Language preference
- **D-05:** Language preference is managed via a **profile modal** (not a separate page), accessible from both the Library view and the Reader view
- **D-06:** Default language for Explainers is **English** — users read books in many languages but typically want explanations in a language they understand
- **D-07:** Per-request language override is available in the explainer UI itself (agent discretion on exact placement)

### Cache key design
- **D-08:** Cache key includes tier from the start: `(content_hash, language, content_type, tier)` — this future-proofs tiered model access (EXP-09 in Phase 5) without requiring a cache migration later

### the agent's Discretion
- Exact display container choice (Sheet, modal, inline, or dedicated panel) for Explainer output
- GSAP animation implementation details (easing curve, stagger timing, whether to use GSAP library or CSS animations)
- Profile modal trigger placement, icon, and exact navigation flow
- Whether to include a quick language switcher in the explainer panel itself
- Exact loading state before streaming begins (skeleton, spinner, pulsing text)
- Error state for failed generation (retry button, fallback message)
- Prompt template variable substitution strategy (what vars are available: `{title}`, `{author}`, `{content}`, `{language}`, etc.)
- OpenRouter model selection for Regular tier (agent should research best cost/quality tradeoff)
- Composite content hash strategy (SHA-256 of source text + prompt template version, or simpler)

</decisions>

<specifics>
## Specific Ideas

- "GSAP-style word-by-word fade in" — the user explicitly wants a cinematic, animated reveal of AI-generated text, not plain streaming. This is a product differentiator.
- Profile settings as a modal rather than a separate page — keeps the user in context (Library or Reader) when adjusting preferences.
- User explicitly wants text selection with "Highlight" and "Explain" options — **deferred to Phase 4** (EXP-03 passage-level Explainers, READ-07 highlights).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Requirements
- `.planning/PROJECT.md` - Vision, core value, constraints, key decisions (OpenRouter, caching, tiering)
- `.planning/REQUIREMENTS.md` - EXP-01..07, LANG-01..02 requirements for this phase
- `.planning/ROADMAP.md` - Phase 3 goal, success criteria, research flags (prompt engineering, cache key design)

### Prior Phase Context
- `.planning/phases/02-core-reading/02-CONTEXT.md` - Reader decisions: full-screen immersive, slide-out ToC panel, content-based positioning
- `.planning/phases/02-core-reading/02-UI-SPEC.md` - Design system (slate preset, spacing, colors, typography), shadcn component usage patterns
- `.planning/phases/01-foundation/01-CONTEXT.md` - Auth patterns, admin panel decisions

### Code References
- `src/server/db/schema.prisma` - Current schema (needs `Explainer` model, `User` needs `preferredLanguage` field)
- `src/components/reader/toc-panel.tsx` - ToC panel with Sheet + ScrollArea — section-level trigger integration point
- `src/components/reader/reader-chrome.tsx` - Slot-based chrome toolbar — potential location for reader-level explainer trigger
- `src/app/(library)/book/[id]/page.tsx` - Book detail page — book-level trigger integration point
- `src/app/profile/page.tsx` - Current standalone profile page — to be converted or supplemented with modal
- `src/server/services/reader.ts` - Reader service patterns (auth-gated CRUD, upsert pattern)
- `src/server/services/library.ts` - Book access verification patterns
- `src/app/api/reader/position/route.ts` - Authenticated API route pattern (GET/POST, access verification, error handling)
- `src/app/admin/prompts/page.tsx` - Prompt template editor UI — shows how templates are loaded/saved
- `src/app/api/admin/prompts/route.ts` - Prompt template API — shows template CRUD pattern
- `prisma/seed.ts` - Existing `PromptTemplate` seed data (book + section types)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/sheet.tsx` - shadcn Sheet, used for ToC panel; can be reused for explainer display panel
- `src/components/ui/scroll-area.tsx` - shadcn ScrollArea, for long explainer text
- `src/components/ui/button.tsx` - Button with variants (ghost, outline, primary)
- `src/components/ui/textarea.tsx` - For any inline prompt editing
- `src/components/ui/tabs.tsx` - Tabs component (used in admin prompts page)
- `src/components/ui/badge.tsx` - Status badges (cached, generating, etc.)
- `src/components/ui/avatar.tsx` - User avatar (profile modal)
- `src/components/ui/skeleton.tsx` - Loading skeletons
- `@likecoin/epub-ts` NavItem type — ToC entries already typed
- `requireAuth()` from `@/lib/auth-guards` — auth-gated server component pattern

### Established Patterns
- Auth-gated API routes: validate access with `verifyBookAccess()` or similar before returning data
- Prisma upsert for user-specific data (position persistence uses upsert)
- TanStack Query (`useQuery`, `useMutation`) for client-side data fetching
- `sonner` for toast notifications
- Slot-based composition in ReaderChrome (tocTrigger, themeToggle as ReactNode props)
- Debounced saves (3s timeout pattern in reader-client.tsx)
- Server actions vs API routes: Phase 1/2 uses API routes consistently

### Integration Points
- Reader chrome toolbar can accept new slots (explainer trigger, language indicator)
- Book detail page has clear space next to "Open Reader" button for an "Explain" action
- ToC panel entries can be augmented with an action button (small icon or hover reveal)
- Profile modal needs trigger in both `(library)/layout.tsx` header and `(reader)/layout.tsx`
- The `PromptTemplate` table already has `book` and `section` rows seeded — new `type` values are not needed
- TXT conversion path (`txtPath` on `EpubFile`) is the grounding source for Explainers
- Admin prompt editing is already live — no new admin UI needed for this phase

</code_context>

<deferred>
## Deferred Ideas

- **Text selection with "Explain" option** (EXP-03, passage-level Explainers) — Phase 4
- **Text selection with "Highlight" option** (READ-07, text highlighting) — Phase 4
- **Bookmarks** (READ-06) — Phase 4
- **In-book search** (READ-08) — Phase 4
- **TTS audio generation** — Phase 5
- **Pro-tier higher-fidelity LLM models** (EXP-09) — Phase 5 (schema prepared in D-08)

</deferred>

---

*Phase: 03-ai-explainers*
*Context gathered: 2026-05-07*
