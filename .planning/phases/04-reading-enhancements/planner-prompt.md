<planning_context>
**Phase:** 4
**Phase Name:** Reading Enhancements
**Mode:** standard
**Goal:** Users can bookmark, highlight, search, and request passage-level Explainers.

<files_to_read>
- .planning/STATE.md (Project State)
- .planning/ROADMAP.md (Roadmap)
- .planning/REQUIREMENTS.md (Requirements)
- .planning/phases/04-reading-enhancements/04-CONTEXT.md (Phase Context - USER DECISIONS)
- .planning/phases/02-core-reading/02-UI-SPEC.md (UI Design Contract - applies to Phase 4 reader features)
- .planning/phases/02-core-reading/02-CONTEXT.md (Prior phase integration)
- .planning/phases/03-ai-explainers/03-CONTEXT.md (Prior phase integration)
- src/server/db/schema.prisma (Current schema - needs Bookmark, Highlight tables)
- src/server/services/reader.ts (Existing reader service pattern)
- src/server/services/explainer.ts (Existing explainer service - needs passage type extension)
- src/app/api/reader/position/route.ts (API route pattern)
- src/app/api/explainers/route.ts (Explainer API pattern)
- src/app/api/explainers/generate/route.ts (SSE streaming pattern)
- src/components/reader/epub-viewer.tsx (EPUB iframe renderer - selection integration point)
- src/components/reader/reader-client.tsx (Reader orchestration)
- src/components/reader/reader-chrome.tsx (Toolbar slot pattern)
- src/components/reader/toc-panel.tsx (Sheet panel pattern)
- src/components/explainer/explainer-panel.tsx (Existing explainer panel to extend)
- src/lib/auth-guards.ts (Auth pattern)
- src/server/services/__tests__/explainer.test.ts (Test pattern)
- src/app/api/explainers/__tests__/route.test.ts (API test pattern)
</files_to_read>

**Phase requirement IDs (EVERY ID MUST appear in a plan's requirements field):** READ-06, READ-07, READ-08, EXP-03, EXP-08

**Existing patterns to mirror exactly:**
- Prisma models: use same field naming conventions as UserBookPosition (userId, bookId, createdAt, updatedAt)
- Auth: `requireAuth()` from `@/lib/auth-guards` + `verifyBookAccess()` before all data access
- API routes: NextResponse.json with {error: string} for errors; 400/401/403/500 status codes
- Service layer: `src/server/services/reader.ts` pattern for CRUD operations
- Tests: vitest with vi.mock for db/auth/services; describe/it/expect pattern
- UI: shadcn components (Sheet, ScrollArea, Button, Badge, Skeleton, Tabs); `cn()` utility; lucide-react icons
- SSE streaming: force-dynamic export, ReadableStream with TextEncoder, `data: [DONE]` termination
- Explainer cache: computeContentHash with SHA-256, @@unique composite key
- Position persistence: debounced saves (3s timeout), upsert pattern
</planning_context>

<downstream_consumer>
Output consumed by /gsd-execute-phase. Plans need:
- Frontmatter (wave, depends_on, files_modified, autonomous)
- Tasks in XML format with read_first and acceptance_criteria fields (MANDATORY on every task)
- Verification criteria
- must_haves for goal-backward verification
</downstream_consumer>

<deep_work_rules>
## Anti-Shallow Execution Rules (MANDATORY)

Every task MUST include these fields - they are NOT optional:

1. **`<read_first>`** - Files the executor MUST read before touching anything. Always include:
   - The file being modified (so executor sees current state, not assumptions)
   - Any "source of truth" file referenced in CONTEXT.md (reference implementations, existing patterns, config files, schemas)
   - Any file whose patterns, signatures, types, or conventions must be replicated or respected

2. **`<acceptance_criteria>`** - Verifiable conditions that prove the task was done correctly. Rules:
   - Every criterion must be checkable with grep, file read, test command, or CLI output
   - NEVER use subjective language ("looks correct", "properly configured", "consistent with")
   - ALWAYS include exact strings, patterns, values, or command outputs that must be present
   - Examples:
     - Code: `auth.py contains def verify_token(` / `test_auth.py exits 0`
     - Config: `.env.example contains DATABASE_URL=` / `Dockerfile contains HEALTHCHECK`
     - Docs: `README.md contains '## Installation'` / `API.md lists all endpoints`
     - Infra: `deploy.yml has rollback step` / `docker-compose.yml has healthcheck for db`

3. **`<action>`** - Must include CONCRETE values, not references. Rules:
   - NEVER say "align X with Y", "match X to Y", "update to be consistent" without specifying the exact target state
   - ALWAYS include the actual values: config keys, function signatures, SQL statements, class names, import paths, env vars, etc.
   - If CONTEXT.md has a comparison table or expected values, copy them into the action verbatim
   - The executor should be able to complete the task from the action text alone, without needing to read CONTEXT.md or reference files (read_first is for verification, not discovery)

**Why this matters:** Executor agents work from the plan text. Vague instructions like "update the config to match production" produce shallow one-line changes. Concrete instructions like "add DATABASE_URL=postgresql://... , set POOL_SIZE=20, add REDIS_URL=redis://..." produce complete work. The cost of verbose plans is far less than the cost of re-doing shallow execution.
</deep_work_rules>

<design_constraints>
**UI Design System (from Phase 2 UI-SPEC):**
- shadcn/ui with slate preset, radix-nova base
- Font: Geist (variable, --font-geist)
- Icons: lucide-react
- Spacing: multiples of 4px
- Reader chrome: h-12 (48px), glassmorphism bg-background/80 backdrop-blur-sm
- Sheet panels: left side for ToC (w-[320px] sm:w-[360px]); right side for Explainer (same width)
- Progress bar: h-1 at bottom
- EPUB iframe: inset-0, no padding
- Toolbar layout: [Back] [ToC] ---- [Book title, centered, truncated] ---- [Theme]
- No new component libraries, icon sets, or fonts may be introduced

**Component patterns:**
- Sheet with side="left" or side="right" for panels
- ScrollArea for long lists
- mount-gated components (useState + useEffect for mounted flag)
- Slot-based composition in ReaderChrome
- Debounced operations (3s timeout)
- TanStack Query for client data (useQuery, useMutation)
- sonner for toast notifications
</design_constraints>

<technical_constraints>
**Tech stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, Prisma 5.22.0, SQLite, Better Auth
**EPUB library:** @likecoin/epub-ts v0.6.3 (rendition.on("selected") for text selection)
**Prisma:** SQLite provider, String for enums (no native enum support)
**Auth:** Better Auth with Google OAuth, role field on User (regular/pro/admin)
**Testing:** Vitest, node environment, vi.mock for dependencies

**CRITICAL SCHEMA NOTES:**
- The `Explainer` model's `contentType` is currently `String` with @@unique([contentHash, language, contentType, tier])
- The `ExplainerLookup` type in explainer.ts only allows `"book" | "section"` for contentType
- For EXP-03 (passage-level), contentType must be extended to include `"passage"`
- The `generateExplainer` function accepts `type: "book" | "section"` and needs extension
- The `GET /api/explainers` and `POST /api/explainers/generate` routes validate type as `"book" | "section"` and need extension
- Prisma schema uses `@@unique([userId, bookId])` pattern for user-book relations (see UserBookAccess, UserBookPosition)
</technical_constraints>

<phase_decisions>
From 04-CONTEXT.md:
- D-01: Hybrid storage for bookmarks/highlights: CFI + paragraph index + literal selected text string
- D-02: Floating toolbar on text selection inside EPUB iframe (rendition.on("selected")); actions: "Highlight" and "Explain this to me"
- D-03: Client-side search: fetch TXT conversion once, search in memory, debounce 300ms, min 3 chars, paragraph-aware results
- D-04: Explainer history integrated into existing Explainer panel as list/detail pivot with Tabs (Current/History)
- D-05: Passage-level Explainers use same Explainer model/cache key; contentType extended with "passage"; content hash from selected text SHA-256
</phase_decisions>

<quality_gate>
- [ ] PLAN.md files created in phase directory (.planning/phases/04-reading-enhancements/)
- [ ] Each plan has valid frontmatter (wave, depends_on, files_modified, autonomous)
- [ ] Tasks are specific and actionable
- [ ] Every task has `<read_first>` with at least the file being modified
- [ ] Every task has `<acceptance_criteria>` with grep-verifiable conditions
- [ ] Every `<action>` contains concrete values (no "align X with Y" without specifying what)
- [ ] Dependencies correctly identified
- [ ] Waves assigned for parallel execution
- [ ] must_haves derived from phase goal
- [ ] ALL 5 requirements covered: READ-06, READ-07, READ-08, EXP-03, EXP-08
</quality_gate>

<output_instructions>
Write PLAN.md files to: .planning/phases/04-reading-enhancements/

Naming convention: 04-01-PLAN.md, 04-02-PLAN.md, etc.

Each plan must include:
1. YAML frontmatter with wave, depends_on, files_modified, autonomous
2. Objective statement
3. Tasks in XML-like tags with read_first, action, acceptance_criteria
4. Verification criteria section
5. must_haves section linking back to phase goal

Use wave structure:
- Wave 1: Schema + foundation (can run first, other waves depend on it)
- Wave 2: Backend APIs + services (depends on Wave 1 schema)
- Wave 3: UI integration (depends on Wave 2 APIs)
- Wave 4+: Final integration features

Aim for 3-5 plans total. Group related features into the same plan when they share files or logic.

Return exactly: `## PLANNING COMPLETE` followed by the plan count and wave breakdown.
</output_instructions>
