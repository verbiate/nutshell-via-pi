# Phase 1: Foundation — Research Document

**Researched:** 2026-05-06
**Purpose:** Answer "What do I need to know to PLAN Phase 1 well?"
**Sources:** STACK.md, ARCHITECTURE.md, FEATURES.md, PITFALLS.md, REQUIREMENTS.md, PROJECT.md, STATE.md, 01-CONTEXT.md

---

## 1. Validation Architecture (Nyquist Dimensions)

Phase 1 delivers 19 requirements across 5 domains. The following testable dimensions must be verifiable before Phase 1 can be marked complete:

### 1.1 Authentication & Authorization (AUTH-01..05)

| Dimension | Testable Assertion | Verification Method |
|-----------|-------------------|---------------------|
| OAuth flow | New user can click "Sign in with Google," authorize, and land on a personalized dashboard within 5 seconds | E2E test with Playwright |
| Session persistence | User refreshes browser and remains authenticated | E2E test: login → refresh → assert session |
| Logout | User can log out from any page and is redirected to unauthenticated state | E2E test across 3+ routes |
| Role assignment | Database contains users with role enum values: `regular`, `pro`, `admin` | Integration test: create user with each role |
| Admin-managed roles | A Regular user cannot self-escalate to Pro or Admin | API test: PATCH `/api/admin/users/:id` with Regular user's session → assert 403 |
| Role enforcement | Admin API endpoints return 403 for non-admin users | API test with each role tier |

### 1.2 EPUB Upload & Deduplication (LIB-01..04)

| Dimension | Testable Assertion | Verification Method |
|-----------|-------------------|---------------------|
| File validation | Non-EPUB files are rejected client-side; files >50MB are rejected | E2E test: upload `.pdf`, `.txt`, 60MB file → assert rejection |
| MD5 computation | Uploading the same EPUB twice produces identical MD5 hashes | Unit test: hash same file twice → assert equal |
| Deduplication | Second upload of same EPUB does not create a new `epub_files` row; grants access to existing | Integration test: upload → upload same file → assert 1 row in `epub_files`, 2 `user_book_access` rows |
| TXT conversion | New EPUB upload creates a TXT file stored alongside the EPUB | Integration test: upload → assert TXT exists in storage |
| Processing feedback | Upload UI shows multi-step progress: hash → check → convert → done | E2E test: assert visible steps |
| Upload redirect | Successful upload redirects to book detail page | E2E test |

### 1.3 Library Views (LIB-05..06)

| Dimension | Testable Assertion | Verification Method |
|-----------|-------------------|---------------------|
| Personal Library isolation | User A sees only books they have access to; User B's books are invisible | Integration test: create 2 users with different access → assert filtered lists |
| Universal Library visibility | Admin can view all `epub_files` regardless of who uploaded | API test: admin GET `/api/admin/books` → assert all books; regular user → assert 403 |
| Empty state | New user sees friendly empty state with "Upload your first book" CTA | E2E test |
| Grid layout | My Library renders books in a responsive grid with cover/placeholder | Visual inspection / component test |
| Metadata display | Book cards show title, author, language badge (if enabled) | Component test |

### 1.4 Admin Panel (ADM-01..07)

| Dimension | Testable Assertion | Verification Method |
|-----------|-------------------|---------------------|
| Route isolation | `/admin/*` routes return 403 for non-admin users; navigation items are hidden | E2E test + API test |
| User list | Admin can view paginated list of all registered users | E2E test |
| Role change | Admin can change user role; change takes effect on next request | Integration test: PATCH role → assert session reflects new role |
| Universal Library view | Admin sees all books with uploader info | E2E test |
| Prompt template editing | Admin can edit book-level and section-level explainer prompts; changes persisted | Integration test: PATCH prompt → assert DB update |
| Audit logging | Every admin action creates an audit log entry with who/what/when/old/new | Integration test: perform admin action → assert audit row |
| Server-side guards | No admin endpoint relies solely on client-side role check | Code review: verify middleware on all `/api/admin/*` routes |

### 1.5 Language Detection (LANG-03)

| Dimension | Testable Assertion | Verification Method |
|-----------|-------------------|---------------------|
| Auto-detection | Uploading a known-language EPUB stores correct language code | Unit test: feed sample texts in EN/ES/FR/VI/DE → assert correct detection |
| User override | Admin or uploader can override detected language | Integration test: upload with override → assert stored value |
| Mixed-language handling | Technical or mixed-language books do not crash detection; defaults gracefully | Unit test: feed mixed/technical content → assert fallback behavior |
| Storage | `epub_files` table has `language` column populated at upload time | DB schema inspection |

---

## 2. Implementation Patterns by Major Area

### 2.1 Authentication (Better Auth + Google OAuth + RBAC)

**Pattern:** Better Auth with Prisma adapter, mounted at `/api/auth/[...all]`.

**Key Implementation Details:**
- Better Auth 1.6.9 provides built-in OAuth, session management, and an `admin` plugin for RBAC
- The `admin` plugin adds `role` field to the user table with values `user`, `admin` — we need to extend this to three roles: `regular`, `pro`, `admin`
- Use Better Auth's `additionalFields` to extend the user schema with `role` as an enum
- All role checks happen server-side in API routes and route handlers; client only receives role info for UI conditional rendering (never for security decisions)

**Critical Decisions Needed:**
1. Should we use Better Auth's built-in `admin` plugin or implement custom RBAC? The admin plugin provides `banUser`, `setRole`, etc. but only supports `user`/`admin`. Extending it for three roles requires custom field mapping.
2. How to handle session invalidation on role change? Better Auth sessions are JWT-based by default; role change must either clear existing sessions or be checked on every request.

**Recommended Approach:**
- Extend Better Auth user schema with `role` enum (`regular`, `pro`, `admin`) via `additionalFields`
- Use a custom middleware for role checks rather than the admin plugin's built-in guards (which are binary)
- Store role in the session token for fast access, but verify against DB on admin actions
- On role change, invalidate all existing sessions for that user (force re-login)

**Files to Create:**
- `src/lib/auth.ts` — Better Auth configuration with Google OAuth, Prisma adapter, role field
- `src/lib/auth-guards.ts` — Server-side role validation helpers (`requireAdmin`, `requireAuth`)
- `src/middleware.ts` — Next.js middleware for route protection (redirect unauthenticated from `/my-library`, `/admin`)
- `src/app/api/auth/[...all]/route.ts` — Better Auth handler mount point

### 2.2 EPUB Upload + MD5 Deduplication

**Pattern:** Streaming upload → streaming MD5 hash → database check → conditional processing.

**Key Implementation Details:**
- Use Next.js App Router Route Handler with `request.formData()` for file upload (no `formidable` needed)
- Stream file through `crypto.createHash('md5')` — never read entire file into memory
- 50MB max file size enforced before hashing begins
- EPUB validation: check ZIP structure, presence of `mimetype` and `META-INF/container.xml`
- If MD5 exists in `epub_files`: create `user_book_access` record, return existing book
- If MD5 is new: parse EPUB with `@likecoin/epub-ts`, extract metadata (title, author, cover, TOC), convert to TXT, store both files

**Critical Decisions Needed:**
1. EPUB parsing happens synchronously or asynchronously? For files <50MB, synchronous parsing in the API route is acceptable for v1. For larger files or queue-based processing, a background worker is needed.
2. TXT storage format: single file or chunked? Architecture research recommends chunked (per-chapter) from day one to avoid massive DB fields. However, Phase 1 only needs metadata + TXT for later AI processing. For simplicity, store TXT as a single file in storage; split into chunks when the reader is built in Phase 2.
3. Cover image extraction: `@likecoin/epub-ts` can extract cover images. Store them in file storage, DB stores path.

**Recommended Approach:**
- Synchronous processing in API route for v1 (Phase 1 scope)
- Store original EPUB and TXT as files in `src/server/storage/` local filesystem
- Store metadata (title, author, md5, language, cover_path, txt_path, toc_json) in `epub_files` table
- Chunk TXT into sections in Phase 2 when building the reader

**Files to Create:**
- `src/server/services/epub-processor.ts` — parse, hash, convert, extract metadata
- `src/server/storage/local.ts` — local filesystem storage abstraction
- `src/server/storage/types.ts` — storage interface for future swap to R2/S3
- `src/app/api/books/upload/route.ts` — upload API route
- `src/components/library/upload-dropzone.tsx` — client upload component

**MD5 Deduplication Logic (Pseudocode):**
```typescript
async function uploadBook(file: File, userId: string) {
  // Validate file type and size
  if (!file.name.endsWith('.epub')) throw new ValidationError('EPUB only');
  if (file.size > 50 * 1024 * 1024) throw new ValidationError('Max 50MB');

  // Stream-compute MD5
  const md5 = await streamHash(file.stream());

  // Check Universal Library
  const existing = await db.epubFile.findUnique({ where: { md5 } });
  if (existing) {
    await db.userBookAccess.upsert({
      where: { userId_bookId: { userId, bookId: existing.id } },
      create: { userId, bookId: existing.id }
    });
    return { book: existing, isNew: false };
  }

  // New book: parse and store
  const parsed = await parseEpub(file);
  const epubPath = await storage.write(`epubs/${md5}.epub`, file);
  const txtPath = await storage.write(`txts/${md5}.txt`, parsed.text);

  const book = await db.epubFile.create({
    data: {
      md5,
      title: parsed.title,
      author: parsed.author,
      language: parsed.detectedLanguage,
      coverPath: parsed.coverPath,
      epubPath,
      txtPath,
      tocJson: JSON.stringify(parsed.toc)
    }
  });

  await db.userBookAccess.create({ data: { userId, bookId: book.id } });
  return { book, isNew: true };
}
```

### 2.3 Library (Universal + Personal)

**Pattern:** Universal Library (`epub_files`, MD5 PK) + Personal Library (`user_book_access` junction table).

**Key Implementation Details:**
- `epub_files` is the single source of truth for all books in the system
- `user_book_access` links users to books they can see
- Personal Library query: JOIN `epub_files` + `user_book_access` where `userId = currentUser`
- Admin Universal Library view: SELECT all from `epub_files` with uploader info (requires tracking uploader on the book record or inferring from first access grant)

**Critical Decisions Needed:**
1. Should `epub_files` store an `uploadedBy` field? Yes — this helps admin identify who first brought a book into the system. However, the book itself is universal; subsequent uploaders simply get access.
2. Should `user_book_access` support deletion ("remove from My Library")? For Phase 1, no — users can only add. Deletion can be added in v1.x. This simplifies the data model.
3. How to handle book metadata editing? Admin can edit metadata in Phase 1; users cannot. Metadata changes affect all users with access.

**Recommended Approach:**
- Add `uploadedByUserId` to `epub_files` (set on first upload, nullable for admin-created entries)
- `user_book_access` has composite PK `(userId, bookId)` — no soft delete in Phase 1
- Admin panel shows `epub_files` with `uploadedBy` and access count (derived from `user_book_access` count)

**Files to Create:**
- `src/server/db/schema.prisma` — full schema (see Dependency Analysis for schema build order)
- `src/server/services/library.ts` — getPersonalLibrary(userId), getUniversalLibrary(), grantAccess(userId, bookId)
- `src/app/api/books/route.ts` — GET my library
- `src/app/api/admin/books/route.ts` — GET universal library (admin only)
- `src/app/(library)/my-library/page.tsx` — Personal Library page
- `src/components/library/book-card.tsx` — book card component
- `src/components/library/bookshelf.tsx` — grid layout component

### 2.4 Admin Panel

**Pattern:** Dedicated `/admin` route group with sidebar layout, server-side role guards on every request, audit logging for all mutations.

**Key Implementation Details:**
- `/admin` is a route group with its own layout (`src/app/admin/layout.tsx`) containing sidebar + collapsible mobile menu
- Sections: Users (`/admin/users`), Universal Library (`/admin/books`), Prompt Templates (`/admin/prompts`), Audit Log (`/admin/audit`)
- Every admin API endpoint uses `requireAdmin()` middleware that checks session role against DB
- Audit log table: `audit_logs` with columns `id`, `actorId`, `action`, `entityType`, `entityId`, `oldValue`, `newValue`, `createdAt`
- Prompt templates stored in DB table `prompt_templates` with columns `id`, `type` (`book` | `section`), `content`, `version`, `createdAt`, `updatedAt`

**Critical Decisions Needed:**
1. Should prompt templates be versioned? Yes — store `version` integer, but only admin can view history in v1. Simplest approach: overwrite in place but keep `updatedAt` for auditing.
2. Should audit logs be queryable by regular users (view their own history)? No — audit logs are admin-only in v1.
3. How to handle sidebar navigation on mobile? Collapsible hamburger menu; sidebar overlays content.

**Recommended Approach:**
- `prompt_templates` table with unique constraint on `(type)` — one active template per type in v1
- Audit log append-only; no editing or deletion
- Admin layout uses shadcn/ui Sidebar, Table, Dialog, and Tabs components
- Use React Query for server state in admin tables (pagination, sorting)

**Files to Create:**
- `src/app/admin/layout.tsx` — admin layout with sidebar
- `src/app/admin/users/page.tsx` — user management
- `src/app/admin/books/page.tsx` — universal library view
- `src/app/admin/prompts/page.tsx` — prompt template editor
- `src/app/admin/audit/page.tsx` — audit log viewer
- `src/app/api/admin/users/route.ts` — user list
- `src/app/api/admin/users/[id]/route.ts` — user update (role change)
- `src/app/api/admin/books/route.ts` — universal library list
- `src/app/api/admin/prompts/route.ts` — prompt CRUD
- `src/app/api/admin/audit/route.ts` — audit log query
- `src/server/services/admin.ts` — admin operations with audit logging

### 2.5 Audit Logging

**Pattern:** Every mutating admin action creates an immutable audit log record.

**Key Implementation Details:**
- Audit logging is a cross-cutting concern implemented in the `admin` service layer
- Logged actions: `USER_ROLE_CHANGED`, `PROMPT_TEMPLATE_UPDATED`, `BOOK_DELETED` (if implemented)
- Old/new values stored as JSON strings
- Audit log visible in admin panel; paginated, sorted by newest first

**Critical Decisions Needed:**
1. Should non-admin actions be audited (e.g., user uploads)? Phase 1 scope says admin actions only. User uploads are tracked via `uploadedBy` on `epub_files`.
2. How long to retain audit logs? Indefinitely for v1; no retention policy needed yet.

**Recommended Approach:**
- Create `auditLog` helper in `src/server/services/admin.ts` that wraps every admin mutation
- Store oldValue/newValue as JSON strings in the DB
- Admin audit page shows table with columns: Time, Admin, Action, Entity, Details

### 2.6 Language Detection

**Pattern:** Automatic language detection at upload time with user/admin override capability.

**Key Implementation Details:**
- Use `franc` or `langdetect` for auto-detection from a sample of the book text (first 5,000 chars)
- Detection runs during EPUB processing after TXT conversion
- Store detected language in `epub_files.language` as ISO 639-1 code (e.g., `en`, `es`, `vi`)
- Admin can override language in the Universal Library view
- Language detection accuracy is a research flag — test with multilingual corpus

**Critical Decisions Needed:**
1. Which detection library? `franc` (fast, statistical, no ML dependencies) vs `langdetect` (Google's port, more accurate but heavier). For v1, `franc` is sufficient and zero-dependency.
2. What sample size? First 5,000 characters is a good balance; too short and accuracy drops, too long and processing slows.
3. Fallback for failed detection? Default to `und` (undetermined) and let admin override.

**Recommended Approach:**
- Use `franc` for detection; sample first 5,000 chars of TXT
- Store ISO 639-1 code; `und` for uncertain
- Admin override via PATCH `/api/admin/books/[id]/language`

**Files to Create:**
- `src/lib/language.ts` — detectLanguage(text: string): string

---

## 3. Dependency Analysis & Build Order

Phase 1 has clear internal dependencies. Components must be built in this order to avoid rework:

### 3.1 Tier 0: Project Scaffolding (Day 1)

1. **Initialize Next.js 16 project** with App Router, TypeScript strict, Tailwind CSS v4
2. **Configure shadcn/ui** — add base components (Button, Card, Dialog, Table, Input, Form, Toast)
3. **Set up Prisma 5.22.0** with SQLite, create `src/server/db/schema.prisma`
4. **Configure Better Auth** with Google OAuth provider, Prisma adapter, role field extension
5. **Set up file storage abstraction** — local filesystem implementation
6. **Configure environment variables** — `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### 3.2 Tier 1: Database Schema (Blocks Everything)

**Prisma schema must be defined before any service code.** Tables needed for Phase 1:

```prisma
// Auth tables (generated by Better Auth CLI + extensions)
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  role          UserRole  @default(regular)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  accounts      Account[]
  bookAccesses  UserBookAccess[]
  auditLogs     AuditLog[] // as actor
}

enum UserRole {
  regular
  pro
  admin
}

// Better Auth tables (Session, Account, Verification) — generated by @better-auth/cli

// Core domain tables
model EpubFile {
  id              String   @id @default(cuid())
  md5             String   @unique // SOLE book identifier — non-negotiable
  title           String
  author          String?
  language        String   @default("und") // ISO 639-1
  coverPath       String?
  epubPath        String   // path to stored EPUB file
  txtPath         String   // path to stored TXT file
  tocJson         String?  // JSON string of TOC hierarchy
  uploadedById    String?
  uploadedBy      User?    @relation(fields: [uploadedById], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  userAccesses    UserBookAccess[]
}

model UserBookAccess {
  id        String   @id @default(cuid())
  userId    String
  bookId    String
  user      User     @relation(fields: [userId], references: [id])
  book      EpubFile @relation(fields: [bookId], references: [id])
  createdAt DateTime @default(now())

  @@unique([userId, bookId])
}

model PromptTemplate {
  id        String   @id @default(cuid())
  type      String   @unique // "book" | "section"
  content   String
  version   Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String
  action     String   // e.g., "USER_ROLE_CHANGED"
  entityType String   // e.g., "user", "prompt", "book"
  entityId   String
  oldValue   String?  // JSON
  newValue   String?  // JSON
  createdAt  DateTime @default(now())
  actor      User     @relation(fields: [actorId], references: [id])
}
```

**Migration order:**
1. Run `@better-auth/cli` to generate auth tables
2. Add custom tables (`EpubFile`, `UserBookAccess`, `PromptTemplate`, `AuditLog`)
3. Run `prisma migrate dev`
4. Seed default prompt templates

### 3.3 Tier 2: Auth & RBAC (Blocks Library and Admin)

1. Configure Better Auth with Google OAuth
2. Implement `requireAuth` and `requireAdmin` server guards
3. Add Next.js middleware for route protection
4. Create login page with Google OAuth button
5. Create basic layout with user dropdown (profile, logout)

### 3.4 Tier 3: EPUB Processor (Blocks Upload and Library)

1. Implement `streamHash` utility (streaming MD5)
2. Implement EPUB validation (ZIP structure check)
3. Integrate `@likecoin/epub-ts` for parsing
4. Implement TXT conversion
5. Implement cover image extraction
6. Integrate language detection (`franc`)

### 3.5 Tier 4: Upload Flow & Personal Library (User-Facing Value)

1. Build upload API route (`POST /api/books/upload`)
2. Build upload dropzone component
3. Build processing feedback UI
4. Build Personal Library page with grid
5. Build book detail page (metadata display, placeholder for Phase 2 reader)

### 3.6 Tier 5: Admin Panel (Depends on Auth + Library)

1. Build admin layout with sidebar
2. Build user management (list, role change)
3. Build Universal Library view
4. Build prompt template editor
5. Build audit log viewer
6. Wire audit logging into all admin mutations

### 3.7 Dependency Graph

```
Project Scaffold
    │
    ▼
Database Schema (Prisma + Better Auth tables)
    │
    ├──► Auth & RBAC ──────┐
    │                       │
    ▼                       ▼
EPUB Processor ◄────── Upload Flow + Personal Library
    │                       │
    │                       ▼
    │               Admin Panel (depends on Auth + Library)
    │
    └──► Language Detection (integrated into EPUB Processor)
```

---

## 4. Risk Assessment & Mitigation

### 4.1 Critical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Prisma 7.x accidentally installed** | Medium | High — breaks runtime DB config, blocks development | Pin `prisma@5.22.0` and `@prisma/client@5.22.0` in `package.json`; add engine-strict; CI check rejects Prisma 7 |
| **EPUB parsing crashes on real-world files** | High | High — upload feature broken for users | Test with 20+ real EPUBs (Project Gutenberg, Calibre, publishers) before shipping; defensive parsing with try/catch per chapter; graceful degradation |
| **Better Auth role extension doesn't work as documented** | Medium | High — RBAC broken | Prototype auth setup first (Day 1); verify role field in session before building admin panel; fallback to custom session cookie if needed |
| **Large EPUBs crash server during hashing** | Medium | High — DoS vulnerability | Enforce 50MB limit; stream hash computation; never use `fs.readFileSync`; monitor memory during upload tests |
| **Language detection inaccurate** | Medium | Medium — wrong language stored, affects Phase 3/5 | Allow admin override from day one; default to `und`; test with multilingual corpus; document known limitations |
| **Admin panel privilege escalation** | Low | Critical — security breach | Server-side guards on every admin endpoint; no client-side-only checks; audit log all mutations; penetration test with Regular user JWT |

### 4.2 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **@likecoin/epub-ts API changes or bugs** | Low | Medium | Wrap parser in adapter layer (`src/lib/epub/adapter.ts`); if library breaks, swap implementation without touching business logic |
| **SQLite concurrency issues** | Low | Medium | Use WAL mode; avoid long transactions; if scaling issues emerge, migration to PostgreSQL is documented in architecture |
| **Google OAuth setup friction** | Medium | Low — blocks dev but not architecture | Create Google Cloud project early; document OAuth credential creation steps; test with localhost callback |
| **Cover image extraction fails for many EPUBs** | High | Low — UI degrades gracefully | Generic placeholder generator (book icon + colored background from title hash) ready as fallback |

### 4.3 Process Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Scope creep into Phase 2 features** | Medium | Medium — delays Phase 1 | Strict requirement checklist; any feature not in AUTH-01..05, LIB-01..06, ADM-01..07, LANG-03 is deferred |
| **"Summary" terminology leaks into codebase** | High | Low — brand dilution | Glossary document; code review checklist; grep CI check for "summary" in user-facing strings |
| **Design refinement consumes disproportionate time** | Medium | Medium — user deferred design details | Use frontend design skill for best-practice defaults; accept "good enough" for v1; document deferred polish items |

---

## 5. Key Technical Decisions for the Planner

### 5.1 Decisions Already Made (Do Not Revisit)

| Decision | Rationale | Source |
|----------|-----------|--------|
| MD5 as sole book identifier | User mandate; non-negotiable | PROJECT.md, memory |
| Prisma 5.22.0 (not 7.x) | Prisma 7 breaks runtime DB URL config | PITFALLS.md, memory |
| Better Auth (not NextAuth) | Built-in RBAC, Prisma adapter, modern standard | STACK.md |
| Google OAuth only (no email/password) | Simpler UX; Better Auth native support | PROJECT.md |
| SQLite for v1 | Zero-config; migration to PostgreSQL trivial later | STACK.md |
| `@likecoin/epub-ts` (not `epubjs`) | Maintained, TypeScript, 970+ tests, faster | STACK.md |
| Local filesystem storage (not R2/S3) | Simplest for v1; abstracted for future swap | ARCHITECTURE.md |
| Admin-managed roles (no self-serve billing) | Defer payment infrastructure | PROJECT.md |

### 5.2 Decisions the Planner Must Make

| Decision | Options | Recommendation | Trade-offs |
|----------|---------|----------------|------------|
| **Better Auth role implementation** | (a) Extend admin plugin with custom field mapping; (b) Ignore admin plugin, implement pure custom RBAC | (a) Extend admin plugin — use its session/session management but add custom `role` field with three values | (a) Slightly more complex setup but leverages Better Auth's battle-tested session code; (b) More control but re-implements session handling |
| **TXT storage: single file vs chunked** | (a) Single TXT file per book; (b) Chunk into sections from day one | (a) Single file for Phase 1 — simpler schema, no reader yet; chunk in Phase 2 when reader needs section addressing | (a) Less future-proof but faster to ship; (b) More architecturally correct but adds complexity before needed |
| **Prompt template storage** | (a) Database table (editable by admin); (b) Code files (version controlled) | (a) Database table — ADM-04/05 requirement; store default prompts in seed script | (a) Admin can edit without deploy; (b) Better version control, but requires code change for prompt tweaks |
| **Upload processing: sync vs async** | (a) Synchronous in API route; (b) Queue-based background worker | (a) Synchronous for Phase 1 — files are <50MB, processing is fast enough | (a) Simpler; risk of timeout for very large/complex EPUBs; (b) More robust but requires job queue infrastructure |
| **Admin panel UI framework** | (a) shadcn/ui components only; (b) Add dedicated admin dashboard library | (a) shadcn/ui only — Table, Dialog, Tabs, Sidebar cover all admin needs | (a) Consistent with rest of app; no extra dependency; (b) More polished admin UX but overkill for v1 |
| **Language detection library** | (a) `franc`; (b) `langdetect`; (c) `cld3` | (a) `franc` — zero dependencies, fast, good enough for v1 | (a) Slightly less accurate on short texts; (b) More accurate but requires Python port or heavy deps; (c) Native module complexity |
| **Cover placeholder strategy** | (a) Colored background from MD5 hash; (b) Colored background from title hash | (b) Title hash — same book (same MD5) could have different titles if metadata is corrected; title hash is more visually stable for the same book | Minor UX difference; either works |

### 5.3 Decisions to Defer to Later Phases

| Decision | Why Deferred | Phase to Decide |
|----------|-------------|----------------|
| Reader rendering engine (`react-reader` vs custom) | No reader in Phase 1 | Phase 2 |
| Position tracking implementation details | No reader in Phase 1 | Phase 2 |
| Explainer cache key exact composition | No AI features in Phase 1 | Phase 3 |
| TTS chunking strategy | No TTS in Phase 1 | Phase 5 |
| OpenRouter model selection per tier | No AI features in Phase 1 | Phase 3 |
| PostgreSQL migration timing | SQLite sufficient for v1 | When scaling |

---

## 6. Research Flags & Open Questions

From STATE.md and ROADMAP.md, these flags need validation during Phase 1 implementation:

1. **EPUB parsing robustness** — Test with 20+ real-world EPUBs before marking upload feature complete. Include Project Gutenberg (clean), Calibre outputs (varied), and modern publisher EPUBs (complex CSS).

2. **Language detection accuracy** — Test `franc` with multilingual corpus including: English novels, Spanish technical books, Vietnamese literature, German philosophy, mixed-language content, and very short books (< 10 pages).

3. **Better Auth + Prisma 5 compatibility** — Verify that `@better-auth/cli` generates schema compatible with Prisma 5.22.0 and that the custom `role` field extension works in sessions.

4. **Streaming MD5 performance** — Benchmark hash computation on 10MB, 30MB, and 50MB files to confirm it completes within upload processing time budget (< 5 seconds).

5. **Admin role change session handling** — Verify that changing a user's role invalidates their existing sessions or is reflected on next request. Test edge case: admin changes their own role.

---

## 7. Integration Points with Downstream Phases

Phase 1 must leave clean integration points for Phases 2–5:

| Downstream Phase | Integration Point | What Phase 1 Must Provide |
|-----------------|-------------------|--------------------------|
| Phase 2: Core Reading | Reader opens book by `bookId` | Book detail page at `/book/[id]` with metadata; TXT file accessible; TOC JSON available |
| Phase 2: Core Reading | Reading position persistence | `reading_positions` table can be added; Phase 1 schema should not block this |
| Phase 3: AI Explainers | Explainer generation API | `PromptTemplate` table seeded with defaults; `epub_files.txtPath` points to valid TXT |
| Phase 3: AI Explainers | Explainer caching | Schema supports `ai_outputs` table addition; `content_hash` logic can be added |
| Phase 4: Reading Enhancements | Bookmarks/highlights | `user_book_access` establishes user-book relationship; annotation tables can be added |
| Phase 5: TTS Audio | Audio generation and caching | `epub_files.language` drives voice selection; storage abstraction supports audio files |

---

## 8. Summary for the Planner

**Phase 1 is about laying a solid foundation.** The critical path is:

1. **Database schema first** — Prisma 5 + Better Auth tables + custom domain tables
2. **Auth second** — Google OAuth working, roles in session, guards on routes
3. **EPUB pipeline third** — streaming hash, parsing, TXT conversion, language detection
4. **User-facing value fourth** — upload dropzone, Personal Library grid, book detail page
5. **Admin fifth** — sidebar layout, user management, prompt editing, audit logging

**The biggest risks are:**
- Accidentally installing Prisma 7 (breaks everything — pin 5.22.0)
- EPUB parser crashing on real files (test aggressively with real corpus)
- Admin panel becoming a security vulnerability (server-side guards only)

**The most important quality gates:**
- Same EPUB uploaded twice = 1 `epub_files` row, 2 `user_book_access` rows
- Regular user hitting `/api/admin/*` = 403
- Admin changing user role = audit log entry + session invalidation
- Uploading 60MB EPUB = graceful rejection
- Codebase search for "summary" in user-facing code = 0 results

---

*Research completed: 2026-05-06*
*Next step: Implementation planning*
