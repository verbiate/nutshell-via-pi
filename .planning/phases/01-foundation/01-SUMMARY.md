---
phase: 01-foundation
plan: 01
subsystem: foundation
tags: [next.js, typescript, prisma, shadcn, tailwind, vitest, playwright]
provides:
  - Next.js 16 project with TypeScript strict mode and Tailwind CSS v4
  - Prisma 5 ORM with SQLite database and all Phase 1 models (User, Session, Account, Verification, EpubFile, UserBookAccess, PromptTemplate, AuditLog)
  - shadcn/ui component library with 22 components (button, card, dialog, table, input, label, badge, skeleton, tabs, textarea, dropdown-menu, sidebar, sheet, command, pagination, select, separator, avatar, tooltip, scroll-area, sonner, input-group)
  - File storage abstraction with LocalStorage implementation
  - Test infrastructure (vitest + playwright) with stubs for AUTH-01..05, LIB-01..04, ADM-01..07, LANG-03
  - 2 seeded PromptTemplate records (book-level and section-level Explainer prompts)
  - Minimal landing page with BusyReader branding
affects: [02-core-reading, 03-ai-explainers, 04-reading-enhancements, 05-tts-audio]
tech-stack:
  added:
    - next@16.2.5
    - react@19.2.6
    - typescript@6.0.3
    - prisma@5.22.0 + @prisma/client@5.22.0
    - better-auth@1.6.9
    - tailwindcss@4.2.4 + @tailwindcss/postcss@4.2.4
    - shadcn@4.7.0 (22 components)
    - vitest@4.1.5
    - @playwright/test@1.59.1
    - tsx@4.20.6
    - @likecoin/epub-ts@0.6.3
    - jszip@3.10.1
    - @tanstack/react-query@5.100.9
    - zustand@5.0.13
    - lucide-react@1.14.0
    - class-variance-authority@0.7.1
    - clsx@2.1.1
    - tailwind-merge@3.5.0
    - sonner@2.0.7
    - franc@6.2.0
    - cmdk@1.1.1
    - next-themes@0.4.6
    - radix-ui@1.4.3
    - tw-animate-css@1.4.0
  patterns:
    - Server-only code in src/server/ (not exposed to client bundle)
    - Storage abstraction interface (StorageProvider) with LocalStorage implementation
    - Prisma singleton pattern via globalThis for dev hot-reload safety
    - shadcn/ui copy-paste components (not a runtime dependency)
key-files:
  created:
    - src/server/db/schema.prisma - Full Prisma schema with all Phase 1 models
    - src/server/db/index.ts - Prisma client singleton
    - src/server/storage/types.ts - StorageProvider interface
    - src/server/storage/local.ts - LocalStorage implementation
    - src/lib/utils.ts - cn() utility for Tailwind class merging
    - src/types/book.ts - Book, BookWithAccess, UserRole types
    - src/app/layout.tsx - Root layout with Geist font and Toaster
    - src/app/page.tsx - Minimal BusyReader landing page
    - src/app/globals.css - Tailwind CSS v4 imports and shadcn CSS variables
    - vitest.config.ts - Vitest configuration with node environment and @ alias
    - playwright.config.ts - Playwright configuration with chromium, HTML reporter
    - src/test-setup.ts - Test environment variables
    - src/server/__tests__/*.ts - 5 test stubs for Phase 1 requirements
    - e2e/*.spec.ts - 3 E2E test stubs (auth, library, admin)
    - prisma/seed.ts - Seed script with book and section PromptTemplate records
    - components.json - shadcn/ui configuration
  modified:
    - package.json - Added all dependencies with pinned versions
    - tsconfig.json - Added strict:true, paths.@/*, vitest/globals types
    - .gitignore - Ignore node_modules, .next, .env, *.db, data/uploads/*
    - .env.example - All required environment variables documented
    - .env - Development environment with DATABASE_URL pointing to prisma/dev.db
key-decisions:
  - "UserRole stored as String (not enum) because SQLite lacks native enum support — application-level validation enforces valid values"
  - "Prisma schema at src/server/db/schema.prisma (not prisma/schema.prisma) — Prisma CLI --schema flag used for all commands"
  - "shadcn/ui initialized with radix-nova preset (not slate) — Nova preset used because shadcn CLI --base-color flag unavailable in this version"
  - "form component unavailable in shadcn v4.7 — React Hook Form with zod should be used directly in forms"
  - "prisma/dev.db at project root (prisma/dev.db) — DATABASE_URL uses absolute path for Prisma client compatibility"
  - "gitignore data/uploads/* with negation !data/uploads/.gitkeep — ensures directory structure tracked without upload files"
patterns-established:
  - "Prisma schema uses @relation with onDelete:Cascade for all User relations"
  - "Storage abstraction enables future swap to S3/R2 without changing service code"
  - "Test stubs use it.todo() (vitest) and test.skip() (playwright) for Wave 0 requirements"
requirements-completed: []
duration: 20min
completed: 2026-05-06
---

# Phase 1: Foundation Summary

**Next.js 16 project scaffold with TypeScript strict mode, Prisma 5 ORM with SQLite database, shadcn/ui component library (22 components), file storage abstraction, and test infrastructure (vitest + playwright)**

## Performance
- **Duration:** ~20 min
- **Started:** 2026-05-06T02:21:00Z
- **Completed:** 2026-05-06T02:32:00Z
- **Tasks:** 7
- **Files modified:** ~45

## Accomplishments
- Fully functional Next.js 16 project with TypeScript strict mode and Tailwind CSS v4
- Complete Prisma 5 schema with 8 models (User, Session, Account, Verification, EpubFile, UserBookAccess, PromptTemplate, AuditLog) and SQLite database migrated
- shadcn/ui initialized with 22 components; Toaster (sonner) integrated into root layout
- File storage abstraction with LocalStorage implementation (StorageProvider interface)
- Test infrastructure configured (vitest unit tests + playwright E2E tests) with stubs for all Phase 1 requirements
- 2 PromptTemplate records seeded (book-level and section-level Explainer prompts)
- Minimal landing page with BusyReader branding and Geist font

## Task Commits

1. **Task 01: Initialize Next.js 16 project** - `5dccb89` (feat)
2. **Task 02: Install pinned dependencies and configure PostCSS** - `337bbb4` (feat)
3. **Task 03: Initialize shadcn/ui with radix-nova preset** - `0aaaa19` (feat)
4. **Task 04: Define Prisma 5 schema with all Phase 1 tables** - `7c3176e` (feat)
5. **Task 05: Configure vitest and create test stubs** - `81db0ef` (feat)
6. **Task 06: Create file storage abstraction and .env** - `0ce17de` (feat)
7. **Task 07: Create root layout with Toaster, landing page** - `c118d17` (feat)

## Files Created/Modified
- `package.json` - All dependencies with exact version pins (next@16.2.5, prisma@5.22.0, better-auth@1.6.9, etc.)
- `tsconfig.json` - TypeScript strict mode, path aliases, vitest/globals types
- `src/server/db/schema.prisma` - Full Prisma schema (User, Session, Account, Verification, EpubFile, UserBookAccess, PromptTemplate, AuditLog)
- `src/server/db/index.ts` - Prisma singleton with globalThis pattern
- `src/server/storage/types.ts` - StorageProvider interface (write, read, exists, delete, getUrl)
- `src/server/storage/local.ts` - LocalStorage implementation using fs/promises
- `src/app/layout.tsx` - Root layout with Geist font, Toaster, metadata
- `src/app/page.tsx` - BusyReader landing page (28px semibold heading, slate-50 bg)
- `src/types/book.ts` - Book, BookWithAccess, UserRole types
- `components.json` - shadcn/ui config with radix-nova style, slate baseColor
- `src/components/ui/` - 22 shadcn components (button, card, dialog, table, etc.)
- `vitest.config.ts` - Vitest with node environment, @ alias, globals
- `playwright.config.ts` - Playwright with chromium, HTML reporter, localhost:3000
- `src/test-setup.ts` - Test env vars (DATABASE_URL, BETTER_AUTH_SECRET, STORAGE_PATH)
- `src/server/__tests__/` - 5 test stubs (auth, epub, upload, admin, lang)
- `e2e/` - 3 E2E test stubs (auth, library, admin)
- `prisma/seed.ts` - Seeds 2 PromptTemplate records (book and section)
- `.env` - DATABASE_URL absolute path, BETTER_AUTH_SECRET, STORAGE_PATH
- `.env.example` - All 6 environment variables documented

## Decisions & Deviations

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] UserRole stored as String instead of enum**
- **Found during:** Task 04 (Prisma schema creation)
- **Issue:** SQLite (Prisma 5.22.0) does not support native enum types — would cause schema validation error
- **Fix:** Changed `enum UserRole { regular pro admin }` to `String` with `@default("regular")` — application-level validation enforces valid values
- **Files modified:** src/server/db/schema.prisma
- **Verification:** `npx prisma generate` exits 0, migration applied successfully
- **Committed in:** `7c3176e` (Task 04 commit)

**2. [Rule 1 - Bug Fix] fs.createWriteStream not available in fs/promises**
- **Found during:** Task 06 (LocalStorage implementation)
- **Issue:** `fs/promises` does not export `createWriteStream` — TypeScript error TS2339
- **Fix:** Imported `createWriteStream` separately from `fs`, used it for readable stream piping
- **Files modified:** src/server/storage/local.ts
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** `0ce17de` (Task 06 commit)

**3. [Rule 1 - Bug Fix] Vitest globals types not recognized by TypeScript**
- **Found during:** Task 05 (vitest config)
- **Issue:** `describe` and `it` not found — vitest globals not included in tsconfig types
- **Fix:** Added `"vitest/globals"` to tsconfig `types` array
- **Files modified:** tsconfig.json
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** `81db0ef` (Task 05 commit)

**4. [Rule 1 - Bug Fix] Playwright test.skip signature incompatibility**
- **Found during:** Task 05 (playwright e2e stubs)
- **Issue:** `test.skip("E2E auth tests")` signature not supported — TypeScript error TS2769
- **Fix:** Changed to `test.skip(true, "E2E auth tests")` using boolean condition form
- **Files modified:** e2e/auth.spec.ts, e2e/library.spec.ts, e2e/admin.spec.ts
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** `81db0ef` (Task 05 commit)

**5. [Rule 3 - Blocking] Prisma schema path mismatch**
- **Found during:** Task 01 (package.json creation)
- **Issue:** Prisma CLI defaults to `prisma/schema.prisma` but schema is at `src/server/db/schema.prisma`
- **Fix:** Added `--schema=src/server/db/schema.prisma` to all prisma commands in package.json scripts
- **Files modified:** package.json
- **Verification:** `npx prisma generate --schema=src/server/db/schema.prisma` exits 0
- **Committed in:** `7c3176e` (Task 04 commit)

**6. [Rule 3 - Blocking] DATABASE_URL relative path resolution mismatch**
- **Found during:** Task 04 (migration + seed verification)
- **Issue:** Prisma resolves DATABASE_URL relative to schema.prisma location; Next.js app resolves relative to cwd — mismatched paths
- **Fix:** Used absolute path `file:/Volumes/My Shared Files/Dev/busyreader-via-pi/prisma/dev.db` for DATABASE_URL
- **Files modified:** .env
- **Verification:** `npx tsx -e "..."` outputs correct seed count (2)
- **Committed in:** `7c3176e` (Task 04 commit)

### Planned Deviations (Known Issues)

**1. [Deviation from UI-SPEC] shadcn initialized with radix-nova preset instead of slate base color**
- **Reason:** shadcn CLI `--base-color slate` flag not available in v4.7.0; Nova preset used as functionally equivalent
- **Impact:** None — colors/semantics identical; slate CSS variables preserved in globals.css
- **Files modified:** components.json, src/app/globals.css
- **Committed in:** `0aaaa19` (Task 03 commit)

**2. [Deviation from Plan] form component not installed**
- **Reason:** shadcn v4.7.0 does not include a form component; React Hook Form integration requires separate setup
- **Impact:** Minimal — no Phase 1 requirement needs a form component yet; can be added when Phase 2+ needs forms
- **Files:** Not created (form.tsx)
- **Committed in:** N/A (not a bug, just not available)

**3. [Deviation from Plan] @better-auth/cli@1.6.9 does not exist**
- **Reason:** Latest stable @better-auth/cli is 1.4.21; used 1.4.21 instead
- **Impact:** None — better-auth@1.6.9 is installed for runtime; CLI is only for schema generation
- **Files modified:** package.json
- **Committed in:** `5dccb89` (Task 01 commit)

---

**Total deviations:** 6 auto-fixed (3 missing critical/blocking, 3 bug fixes)
**Planned deviations:** 3 (shadcn preset, missing form, @better-auth/cli version)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep. All 7 tasks completed successfully.

## Issues Encountered
- **npm peer dependency conflict** (vite version mismatch with better-auth): Resolved with `npm install --legacy-peer-deps`
- **shadcn init interactive prompts**: Worked around by manually creating components.json then running `npx shadcn init --yes --template next --base radix --force`
- **git add .gitkeep files in ignored directory**: Resolved by creating local `.gitignore` inside `data/uploads/` that tracks subdirectories but ignores uploaded files
- **Prisma 7 upgrade warning**: Shown during `prisma generate` but Prisma 5.22.0 is intentionally pinned per project constraints

## User Setup Required
None — no external service configuration required for Phase 1 scaffolding. The `.env.example` documents all required variables.

## Next Phase Readiness
- **Database schema:** Ready — all Phase 1 tables created, migrations applied, seed data in place
- **Storage:** Ready — LocalStorage implementation complete, can be swapped for S3/R2
- **Auth:** Ready — Better Auth 1.6.9 installed; Google OAuth credential setup needed before AUTH-01 tests
- **Test infrastructure:** Ready — vitest + playwright configured; stubs in place for all Phase 1 requirements
- **Prerequisite for Phase 2:** EPUB processor, upload API, Personal Library pages, auth flows

---
*Phase: 01-foundation*
*Completed: 2026-05-06*

## Self-Check: PASSED

**Verification commands run:**
- `npx tsc --noEmit` → exits 0 ✓
- `npm run build` → exits 0, "Compiled successfully" ✓
- `npx vitest run` → 5 tests skipped (todo), 0 failures ✓
- `npx prisma generate` → exits 0, Prisma Client generated ✓
- `npx tsx -e "..."` (seed verification) → outputs "2" ✓
- `sqlite3 prisma/dev.db ".tables"` → shows all 9 tables ✓
- `ls src/components/ui/*.tsx | wc -l` → 22 components ✓
- `ls src/server/db/schema.prisma src/server/db/index.ts src/server/storage/types.ts src/server/storage/local.ts` → all exist ✓
