# Phase 2: Core Reading Experience - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can read books with excellent typography, navigate via hierarchical Table of Contents, switch between three themes (light/dark/sepia), and resume reading at their exact last position. The reader renders directly from the EPUB file for rich formatting and images. Bookmarks, highlights, search, and AI features are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Rendering approach
- **D-01:** Render directly from the EPUB file — NOT from the TXT conversion. The TXT is for the AI pipeline only (Explainers, TTS). The reader gets full formatting, images, and proper chapter structure from the EPUB.
- **D-02:** The `@likecoin/epub-ts` package (already installed) or `epubjs` should be evaluated for EPUB rendering in the browser. The ROADMAP.md flags that `react-reader` wraps unmaintained `epubjs` — researcher must validate stability or plan a custom React wrapper (~200 LOC fallback).

### Reader layout & navigation
- **D-03:** Full-screen immersive reader. No persistent sidebar or chrome — the book content fills the viewport.
- **D-04:** Table of Contents accessed via a slide-out panel (shadcn `Sheet` component already available). User opens it, taps an entry, jumps to that section, and the panel closes.
- **D-05:** Dedicated reader route at `/book/[id]/reader` (full page transition from book detail page, not an overlay).
- **D-06:** The "Open Reader" button on the existing book detail page (`src/app/(library)/book/[id]/page.tsx`) will navigate to the reader route instead of being disabled.

### Theme & typography
- **D-07:** Three themes required: light, dark, and sepia. `next-themes` is already installed and available.
- **D-08:** Minimal typography controls for v1 — just theme switching. Font size, font family, line spacing, and margins are deferred to a future version.
- **D-09:** Theme switching must be instant with no page reload (READ-02 success criteria).

### Position persistence
- **D-10:** Reading position (paragraph index + char offset per READ-05) is saved and resumed on return. Exact autosave strategy (debounced on scroll, on visibility change, on navigation) is agent's discretion.
- **D-11:** Position must survive theme changes and font-size changes (if font size is later added). Content-based positioning (paragraph index + char offset) is the required approach, not pixel/scroll offsets.

### the agent's Discretion
- Exact autosave frequency and debounce timing for position persistence
- Loading state while EPUB renders (skeleton, spinner, progress bar)
- Back navigation from reader to book detail page (X button, back arrow, escape key)
- Scroll behavior within the reader (continuous scroll vs paginated)
- Error state if EPUB fails to render
- Mobile responsiveness details (touch gestures, ToC panel width)
- Exact visual design of the reader chrome (toolbar, theme toggle, ToC trigger button)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack & Architecture (from Phase 1)
- `.planning/research/STACK.md` - Full technology stack with versions. Prisma 5.22.0, Next.js 16.2.5, `@likecoin/epub-ts@0.6.3`.
- `.planning/research/ARCHITECTURE.md` - System architecture, project structure, data flows.
- `.planning/research/FEATURES.md` - Feature-by-feature breakdown with implementation notes.
- `.planning/research/PITFALLS.md` - Known issues and failure modes.

### Project Definitions
- `.planning/PROJECT.md` - Vision, core value, constraints, key decisions.
- `.planning/REQUIREMENTS.md` - All 47 v1 requirements. Phase 2 covers READ-01..05.
- `.planning/ROADMAP.md` - Phase 2 success criteria and research flags (epubjs stability, content-based position tracking).
- `.planning/phases/01-foundation/01-CONTEXT.md` - Phase 1 context (established patterns, integration points).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/sheet.tsx` - shadcn Sheet component, ideal for slide-out ToC panel
- `src/components/ui/scroll-area.tsx` - shadcn ScrollArea, useful for ToC list
- `src/components/ui/button.tsx` - Button component with variants
- `src/components/ui/tooltip.tsx` - Tooltip component
- `next-themes` (v0.4.6) - Already installed, provides `ThemeProvider` and `useTheme`
- `src/lib/utils.ts` - `cn()` Tailwind utility
- `src/types/book.ts` - `Book`, `BookWithAccess` types
- `src/server/services/epub-processor.ts` - `TocEntry` interface: `{id, title, href, children?, level}` — hierarchical ToC structure already defined
- `src/server/services/library.ts` - `getBookForUser()` for auth-gated book access

### Established Patterns
- Auth-gated server components: `requireAuth()` from `@/lib/auth-guards`
- Library layout with header at `src/app/(library)/layout.tsx`
- Prisma client via `src/server/db/index.ts`
- File serving via `/api/files/` routes (covers already served this way)

### Integration Points
- Book detail page (`src/app/(library)/book/[id]/page.tsx`) has a disabled "Open Reader" button — this becomes the entry point to the reader
- `tocJson` field on `EpubFile` model contains the serialized hierarchical ToC
- `epubPath` field stores the path to the EPUB file on disk — the reader will need to access this
- The `(library)` route group provides the authenticated layout; the reader route should be inside this group or share its auth patterns
- EPUB files are served/stored via the storage abstraction (`src/server/storage/`)

</code_context>

<specifics>
## Specific Ideas

- User envisions the reading experience as "as polished as Apple Books or Kindle" (ROADMAP.md success criterion #5).
- No specific design references given — open to standard approaches for an ebook reader.
- Typography controls (font size, family, spacing, margins) are explicitly wanted in a future version but deferred now.

</specifics>

<deferred>
## Deferred Ideas

- Font size, font family, line spacing, and margin controls — deferred to future version per user
- Bookmarks (READ-06) — Phase 4
- Highlights (READ-07) — Phase 4
- In-book search (READ-08) — Phase 4
- Passage-level Explainers (EXP-03) — Phase 4

</deferred>

---

*Phase: 02-core-reading*
*Context gathered: 2026-05-07*
