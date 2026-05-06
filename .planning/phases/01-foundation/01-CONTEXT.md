# Phase 1: Foundation - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can authenticate via Google OAuth, upload EPUBs with MD5 deduplication against the Universal Library, browse their Personal Library ("My Library"), and admins can manage users, view all books, and edit LLM prompt templates. All other phases depend on this foundation.

</domain>

<decisions>
## Implementation Decisions

### Library browsing experience
- **D-01:** Grid layout for "My Library" — cards arranged in a responsive grid (similar to Apple Books/Kindle). List view toggle deferred to a later version.
- **D-02:** Cover images extracted from uploaded EPUBs where available; generic placeholder (book icon + colored background derived from title hash) when no cover is found.
- **D-03:** Per-book metadata displayed: title, author, detected language badge. No reading progress indicator in Phase 1 (reader doesn't exist yet).
- **D-04:** Empty state: friendly illustration + "Upload your first book" CTA with a prominent upload button.

### Upload flow & feedback
- **D-05:** Drag-and-drop zone as primary upload mechanism, with a fallback file picker button. Standard file input accept=".epub".
- **D-06:** Processing feedback shown as a multi-step indicator: "Computing hash → Checking library → Converting → Done". Each step visible to the user.
- **D-07:** On successful upload (new book), redirect to the book detail page.
- **D-08:** On MD5 match (existing book), show a toast: "You now have access to [Book Title]" and redirect to the book detail page.
- **D-09:** Upload validation: reject non-EPUB files client-side, max file size 50MB (generous for EPUBs, can be adjusted).

### Admin panel structure
- **D-10:** Dedicated `/admin` route group with a sidebar layout (collapsible on mobile). Sections: Users, Universal Library, Prompt Templates.
- **D-11:** Admin routes require server-side role validation on every request (no client-side-only guards). Unauthorized access returns 403.
- **D-12:** Admin action audit log stored in database — who, what, when, old/new values. Visible in a read-only "Audit Log" section of the admin panel.

### Role visibility & feature gating
- **D-13:** Admin routes are completely hidden from non-admin users — no navigation items, no disabled links. Role check happens at the route/layout level.
- **D-14:** User role badge shown on their profile page (Regular / Pro / Admin). No self-serve upgrade path in v1.
- **D-15:** For Phase 1 specifically, no Pro-gated features exist yet. When Pro features are introduced in later phases, they will be visible but locked for Regular users (teaser pattern), not hidden.

### the agent's Discretion
- Exact spacing, typography, and color palette for library grid cards
- Loading skeleton design for library and book detail pages
- Toast notification styling and duration
- Exact sidebar navigation item ordering and icons
- Admin table pagination and sorting defaults
- Upload dropzone visual design (border style, animation)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack & Architecture
- `.planning/research/STACK.md` - Full technology stack with versions, installation commands, and compatibility matrix. **Critical:** Prisma 5.22.0 (not 7.x), Better Auth 1.6.9, Next.js 16.2.5.
- `.planning/research/ARCHITECTURE.md` - System architecture diagram, project structure recommendation, design patterns (Universal Library with Access Grants, AI Output Caching, Tiered AI Provider), data flows, anti-patterns, and build order.
- `.planning/research/FEATURES.md` - Feature-by-feature breakdown with implementation notes.
- `.planning/research/PITFALLS.md` - Known issues and failure modes to avoid.

### Project Definitions
- `.planning/PROJECT.md` - Vision, core value, constraints, key decisions (OpenRouter, MD5 dedup, admin-managed roles).
- `.planning/REQUIREMENTS.md` - All 47 v1 requirements mapped to phases. Phase 1 covers AUTH-01..05, LIB-01..06, ADM-01..07, LANG-03.
- `.planning/ROADMAP.md` - Phase boundaries, success criteria, research flags, and phase ordering rationale.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- No existing code — this is a greenfield project. All components, hooks, and utilities will be created in Phase 1.

### Established Patterns
- Stack decisions from research are locked: Next.js 16 App Router, Prisma 5 + SQLite, Better Auth, Tailwind CSS v4, shadcn/ui.
- Project structure will follow the ARCHITECTURE.md recommendation: `src/app/` for routes, `src/server/` for server-only code, `src/components/` for React components.

### Integration Points
- Better Auth handlers will be mounted at `/api/auth/[...all]` — this is the auth integration point for all protected routes.
- Prisma schema in `src/server/db/schema.prisma` — all database access flows through here.
- File storage abstraction in `src/server/storage/` — starts with local filesystem, swappable for object storage later.

</code_context>

<specifics>
## Specific Ideas

- User explicitly deferred detailed design refinement: "I will be refining these in a later version. For now, I trust you to use your best judgement here."
- MD5 as sole book identifier is non-negotiable — different editions are treated as completely different books.
- Admin-managed roles only — no self-serve billing in v1.

</specifics>

<deferred>
## Deferred Ideas

- List view toggle for My Library — deferred to later version per user
- Detailed visual design refinement — deferred to later version per user
- Native mobile app — v2 consideration (PROJECT.md Out of Scope)
- Self-serve billing/upgrade — v2 consideration (PROJECT.md Out of Scope)
- PDF/DOCX/MOBI support — v2 consideration (PROJECT.md Out of Scope)

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-05-06*
