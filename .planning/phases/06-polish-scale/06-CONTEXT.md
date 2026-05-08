# Phase 6: Polish & Scale - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Visual polish and finishing touches that make the app feel production-ready. This phase delivers: a polished bookshelf experience with reading progress indicators, Pro badges surfaced in the UI, and overall visual refinements to the library and reader surfaces. Cover extraction and admin model configuration are already complete from prior phases. Cost tracking is explicitly deferred.

**Requirements:** POL-01 (covers, already done), POL-02 (progress indicators), POL-03 (tier config, already done), POL-04 (cost tracking, DEFERRED), POL-05 (Pro badges).

**Net new work:** Reading progress on book cards, Pro badges in UI, bookshelf visual polish.

</domain>

<decisions>
## Implementation Decisions

### Reading progress on book cards (POL-02)
- **D-01:** Thin progress bar along the bottom of each book card showing % read (e.g. "47%"). Clean, minimal, Kindle-style.
- **D-02:** Progress is computed from `UserBookPosition.paragraphIndex` relative to total paragraphs in the book. Books never opened show no progress bar.

### Pro badges (POL-05)
- **D-03:** Pro badges are agent's discretion for placement. User envisioned them in a top-of-page bar alongside other UI elements, but trusts the agent to find the right location given the actual layout. Should feel natural, not intrusive.
- **D-04:** Badge visibility: Pro users see "Pro" badge; Admin users see "Admin" badge; Regular users see no badge. Existing `RoleBadge` component in profile page can be extended or reused.

### Bookshelf polish
- **D-05:** Visual refinements to the bookshelf are agent's discretion. **The implementing agent MUST read and apply these frontend design skills before writing bookshelf code:**
  - `ui-design-toolkit` — typography, spacing, color, layout, and motion guidelines
  - `visual-design` — grid anatomy, typographic rhythm, dynamic layouts, size contrast
  - `frontend-design` — distinctive, production-grade frontend interfaces, avoids generic AI aesthetics
  - These skills are in the project's `<available_skills>` and should be loaded via the skill tool before implementation.
- **D-06:** Cover extraction is already working (POL-01 done). The polish is about the card design, layout, spacing, hover states, and overall visual quality — not about extracting more covers.

### Cost tracking (POL-04)
- **D-07:** Explicitly deferred. Intended to be a "beautiful proof of concept" but not needed yet. Do not build cost tracking infrastructure in this phase.

### Already complete (no work needed)
- **POL-01 (Cover extraction):** `extractCover()` in `src/server/services/epub-processor.ts` runs at upload time, stores to `covers/{md5}.jpg`. `BookCard` already renders covers when `coverPath` exists.
- **POL-03 (Tiered AI config):** Full admin config page at `/admin/config` with per-tier OpenRouter/ElevenLabs/fal.ai API keys and model selectors. Working with TanStack Query, save mutations, and badge status indicators.

### Agent's Discretion
- Exact progress bar design (height, color, animation, corner radius)
- Pro badge placement across the UI (header, reader, explainer panel, book detail, book cards)
- Badge visual design (icon, color, size, animation)
- Bookshelf layout refinements (card spacing, hover effects, transitions, empty state polish)
- Whether to add any micro-interactions (card hover zoom, cover shine effect, etc.)
- Whether progress computation happens server-side (in the library query) or client-side
- How to handle the "never opened" state (no bar vs. "0%" bar vs. "New" label)
- Integration of progress data into the existing `getPersonalLibrary` query

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Requirements
- `.planning/PROJECT.md` - Vision, core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` - POL-01..05 requirements
- `.planning/ROADMAP.md` - Phase 6 goal, success criteria, research flags

### Prior Phase Context
- `.planning/phases/02-core-reading/02-CONTEXT.md` - Reader decisions: position tracking (UserBookPosition), CFI-based positioning
- `.planning/phases/02-core-reading/02-UI-SPEC.md` - Design system (slate preset, spacing, colors, typography)
- `.planning/phases/03-ai-explainers/03-CONTEXT.md` - Explainer panel design, SSE streaming, tiered model selection
- `.planning/phases/05-tts-audio/05-CONTEXT.md` - TTS tier decisions, admin config architecture, voice/model per tier

### Code References
- `src/components/library/book-card.tsx` - Current BookCard component (needs progress bar + visual polish)
- `src/components/library/bookshelf.tsx` - Current grid layout (needs visual refinement)
- `src/app/(library)/my-library/page.tsx` - Library page, calls `getPersonalLibrary` (needs to pass progress data)
- `src/server/services/library.ts` - `getPersonalLibrary()` query (needs to include position data for progress calc)
- `src/server/db/schema.prisma` - `UserBookPosition` model (paragraphIndex for progress), `User.role` (for Pro badge)
- `src/components/auth/user-nav.tsx` - Header user nav — potential Pro badge location
- `src/app/(library)/layout.tsx` - Library layout with header — integration point for badge
- `src/app/profile/page.tsx` - Existing `RoleBadge` component — reuse or extend
- `src/components/ui/badge.tsx` - shadcn Badge component
- `src/server/services/epub-processor.ts` - Cover extraction (already working, reference only)
- `src/app/admin/config/page.tsx` - Admin config (already working, reference only)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BookCard` component: Already structured with cover image, title, author, language badge. Progress bar can slot in at the bottom of the cover `<div>`.
- `Bookshelf` component: Grid layout with `grid-cols-[repeat(auto-fill,minmax(200px,1fr))]`. Card spacing is 6 (24px).
- `UserBookPosition` model: Has `paragraphIndex` and `bookId`. Joined with book's total paragraph count to compute %.
- `RoleBadge` component: Already differentiates admin/pro/regular with different badge styles.
- `getPersonalLibrary()` service: Returns books with access info. Can be extended to join `UserBookPosition`.
- shadcn components: Badge, Card, Skeleton, Button, Avatar — all available for polish work.
- `storage` abstraction: Cover images served via `/api/files/covers/{id}.jpg`.

### Established Patterns
- Auth-gated server components: `requireAuth()` in page components, pass user.id to services
- Server-side data fetching in page components (no client-side queries for library page)
- TanStack Query for client-side mutations (admin config, profile)
- `sonner` for toast notifications
- Slate color palette with semantic tokens (slate-50 through slate-950)
- shadcn/ui components with consistent styling
- `cn()` utility for Tailwind class merging
- Grid-based bookshelf with 3:4 aspect ratio cards

### Integration Points
- `BookCard` component: Add progress bar to the cover container, wire progress % as a new prop
- `getPersonalLibrary()` query: Join with `UserBookPosition` to include reading progress per book per user
- Library page header: Pro badge next to `UserNav` component
- Reader chrome: Pro badge in the header bar alongside existing controls
- Book detail page: Pro badge near the title or actions area

</code_context>

<specifics>
## Specific Ideas

- Progress bar should feel like Kindle — thin, unobtrusive, shows at a glance how far you are.
- Bookshelf is the first thing users see. It should feel polished and inviting, not just functional.
- Pro badge should be visible but not loud — it's a status indicator, not a billboard.

</specifics>

<deferred>
## Deferred Ideas

- **POL-04: Cost tracking dashboard** — Explicitly deferred by user. "Intended to be a beautiful proof of concept but not needed yet." No version tag assigned. Will be reconsidered when roadmap is solidified.
- **Library-level search** — Noted in Phase 4 as deferred to "future phase, likely Phase 6 or v2". Still deferred.
- **Offline reading / PWA** — Explicitly out of scope for v1.

</deferred>

---

*Phase: 06-polish-scale*
*Context gathered: 2026-05-08*
