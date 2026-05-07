# Architecture Research

**Domain:** AI-Powered Ebook Reading Platform
**Researched:** 2026-05-06
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Client Layer                               │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   Web App    │  │   Admin      │  │     Reader View          │  │
│  │  (Next.js)   │  │   Panel      │  │   (Typography Engine)    │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                       │                │
├─────────┴─────────────────┴───────────────────────┴────────────────┤
│                           API Layer                                  │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Auth    │  │ Library  │  │  Reader  │  │   AI Services    │   │
│  │ Routes   │  │  Routes  │  │  Routes  │  │     Routes       │   │
│  │(Better   │  │(Upload,  │  │(Read,    │  │(Explain,        │   │
│  │  Auth)   │  │  Manage) │  │Bookmark) │  │  Audio)         │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │             │             │                 │              │
├───────┴─────────────┴─────────────┴─────────────────┴──────────────┤
│                          Service Layer                               │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   Library    │  │    Reader    │  │     AI Orchestrator      │  │
│  │   Service    │  │   Service    │  │     (OpenRouter/         │  │
│  │(Universal +  │  │(State, TOC,  │  │     ElevenLabs/          │  │
│  │  Personal)   │  │  Positions)  │  │     fal.ai)              │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                       │                │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌────────────┴─────────────┐  │
│  │  EPUB        │  │  Annotation  │  │  Cache Service           │  │
│  │  Processor   │  │  Service     │  │  (AI Output Deduplication)│  │
│  │(Parse, MD5,  │  │(Bookmarks,  │  │                           │  │
│  │  Convert)    │  │ Highlights)  │  │                           │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                          Data Layer                                  │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ SQLite   │  │  File    │  │  Redis   │  │  External        │   │
│  │(Users,   │  │ Storage  │  │ (Cache   │  │  AI APIs         │   │
│  │  Books,  │  │ (EPUBs,  │  │  Layer)  │  │  (OpenRouter,    │   │
│  │  Access, │  │  Audio)  │  │          │  │  ElevenLabs)     │   │
│  │  Anno)   │  │          │  │          │  │                  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|---------------|------------------------|
| Auth Service | Authentication, role-based access (Regular/Pro/Admin), session management | Better Auth with Next.js, Prisma adapter for RBAC |
| EPUB Processor | Parse EPUB, compute MD5 hash, extract metadata, convert to TXT, store file | Node.js with `epub`/`jszip` libraries, streaming file I/O |
| Library Service | Universal Library management (books, deduplication) + Personal Library (access grants) | Prisma ORM with `epub_files` (MD5 PK) and `user_books` junction tables |
| Reader Service | Serve book content, TOC navigation, position tracking, theme management | React components with virtualized scrolling, index-based position |
| Annotation Service | Persist bookmarks, highlights, resume positions per user per book | Prisma with `annotations` table (type, position, user, book) |
| AI Orchestrator | Route AI requests to correct provider/model tier, manage prompt templates, control costs | Service layer with provider abstraction, tier-based model selection |
| Cache Service | Deduplicate AI outputs per (content_hash, language, content_type, tier) | Prisma `ai_outputs` table with composite unique keys |
| TTS Service | Generate audio via ElevenLabs/fal.ai, stream/serve audio files, cache results | Direct API integration, file storage, metadata tracking |
| Admin Service | Manage user roles, inspect Universal Library, configure prompts and models | Protected routes with Admin role guard, dashboard UI |

---

## Recommended Project Structure

```
src/
├── app/                        # Next.js App Router
│   ├── (auth)/                 # Auth group (login, register)
│   ├── (reader)/               # Reader group (book reading views)
│   │   ├── book/[id]/          # Book detail + reader
│   │   └── layout.tsx          # Reader chrome (TOC, controls)
│   ├── (library)/              # Library group
│   │   ├── my-library/         # Personal Library page
│   │   ├── upload/             # EPUB upload flow
│   │   └── layout.tsx          # Library chrome (shelves, nav)
│   ├── admin/                  # Admin panel (protected)
│   ├── api/                    # API routes
│   │   ├── auth/[...all]/      # Better Auth handlers
│   │   ├── books/              # Book CRUD, upload
│   │   ├── reader/             # Reading position, annotations
│   │   ├── explain/            # Explainer generation
│   │   └── audio/              # TTS generation, audio serve
│   └── layout.tsx              # Root layout (auth context, theme)
│
├── server/                     # Server-only code (not exposed to client)
│   ├── db/                     # Database
│   │   ├── schema.prisma       # Prisma schema
│   │   └── index.ts            # Prisma client singleton
│   ├── services/               # Domain services
│   │   ├── auth.ts             # Role/permission helpers
│   │   ├── library.ts          # Universal + Personal Library ops
│   │   ├── epub-processor.ts   # EPUB parse, hash, convert
│   │   ├── reader.ts           # Position, annotation CRUD
│   │   ├── ai-orchestrator.ts  # LLM/TTS request routing
│   │   ├── explainer.ts        # Explainer generation + caching
│   │   ├── tts.ts              # Audio generation + caching
│   │   └── admin.ts            # Admin operations
│   ├── ai/                     # AI provider integrations
│   │   ├── providers/
│   │   │   ├── openrouter.ts   # OpenRouter client
│   │   │   ├── elevenlabs.ts   # ElevenLabs TTS client
│   │   │   └── fal-ai.ts       # fal.ai TTS client
│   │   ├── prompts/
│   │   │   ├── book-explainer.ts
│   │   │   └── section-explainer.ts
│   │   └── tier-config.ts      # Model selection per tier
│   └── storage/                # File storage abstraction
│       ├── local.ts            # Local filesystem (dev)
│       └── types.ts            # Storage interface
│
├── lib/                        # Shared utilities
│   ├── epub/                   # EPUB parsing utilities
│   ├── auth/                   # Auth helpers, hooks, guards
│   ├── api-client.ts           # Typed API client
│   └── utils.ts                # General utilities
│
├── components/                 # React components
│   ├── ui/                     # shadcn/ui components
│   ├── reader/                 # Reader-specific components
│   │   ├── book-viewer.tsx
│   │   ├── toc-navigator.tsx
│   │   ├── bookmark-button.tsx
│   │   ├── highlight-toolbar.tsx
│   │   └── theme-toggle.tsx
│   ├── library/                # Library components
│   │   ├── bookshelf.tsx
│   │   ├── book-card.tsx
│   │   └── upload-dropzone.tsx
│   ├── explainer/              # Explainer UI components
│   │   ├── explainer-panel.tsx
│   │   └── explainer-loading.tsx
│   ├── audio/                  # Audio player components
│   │   ├── audio-player.tsx
│   │   └── audio-controls.tsx
│   └── admin/                  # Admin panel components
│
├── hooks/                      # Custom React hooks
│   ├── use-reader.ts           # Reader state (position, theme)
│   ├── use-annotations.ts      # Bookmarks/highlights
│   └── use-explainer.ts        # Explainer fetching/generation
│
└── types/                      # Shared TypeScript types
    ├── book.ts
    ├── reader.ts
    ├── explainer.ts
    └── api.ts
```

### Structure Rationale

- **`app/`:** Uses Next.js App Router with route groups `(auth)`, `(reader)`, `(library)` to separate layouts while sharing URL segments. API routes colocated for Next.js convention.
- **`server/`:** Contains all server-only code — database, services, AI integrations, storage. Prevents accidental client bundle bloat or credential leakage. The `services/` layer sits between API routes and database to enforce business rules.
- **`server/ai/`:** Centralizes all AI provider logic. Prompts are versioned files (not DB strings for v1) to enable code review and type safety. Tier config lives here so model selection is explicit.
- **`server/storage/`:** Abstracted interface for file storage — starts with local filesystem, easily swapped for S3/R2 later without touching business logic.
- **`components/reader/`:** Rich, domain-specific components for the reading experience. Separated from library and explainer components to keep bundles focused.
- **`hooks/`:** Encapsulates complex client-side state for the reader (position tracking, annotation UI, explainer panel state).

---

## Architectural Patterns

### Pattern 1: Universal Library with Access Grants

**What:** Books exist in a single global `epub_files` table keyed by MD5 hash. Users do not own books; they have `user_book_access` records linking them to Universal Library entries.

**When to use:** When deduplication and shared AI outputs are core to the product. Prevents storing the same book N times.

**Trade-offs:**
- **Pros:** Massive storage savings; AI outputs naturally shared; single source of truth for book metadata.
- **Cons:** Deleting a "user's book" means revoking access, not deleting data (requires admin rules); access control logic must be checked on every read.

**Example:**
```typescript
// server/services/library.ts
async function uploadBook(file: File, userId: string) {
  const md5 = await computeMd5(file);
  
  const existing = await db.epubFile.findUnique({ where: { md5 } });
  if (existing) {
    // Grant access to existing book — zero duplication
    await db.userBookAccess.upsert({
      where: { userId_bookId: { userId, bookId: existing.id } },
      create: { userId, bookId: existing.id }
    });
    return { book: existing, isNew: false };
  }
  
  // New book — parse, convert, store
  const parsed = await parseEpub(file);
  const book = await db.epubFile.create({
    data: { md5, title: parsed.title, txtContent: parsed.text }
  });
  await db.userBookAccess.create({ data: { userId, bookId: book.id } });
  return { book, isNew: true };
}
```

### Pattern 2: AI Output Caching with Composite Keys

**What:** All AI-generated content (Explainers, audio metadata) is stored with a composite unique key of `(contentHash, language, contentType, tier)` where `contentHash` is MD5 of the input text.

**When to use:** When API costs are a primary concern and generated content is deterministic per input. Critical for OpenRouter/elevenLabs cost control.

**Trade-offs:**
- **Pros:** Zero duplicate API calls; instant response for previously-generated content; transparent cost accounting.
- **Cons:** Database grows with AI outputs; cache invalidation requires explicit strategy (versioned prompts, manual purge); hash collisions theoretically possible (use SHA-256 if concerned).

**Example:**
```typescript
// server/services/explainer.ts
async function getOrGenerateExplainer(
  bookId: string, 
  sectionId: string | null,  // null = book-level
  language: string,
  tier: 'regular' | 'pro'
) {
  const contentHash = await hashContent(bookId, sectionId);
  const cacheKey = { contentHash, language, contentType: 'explainer', tier };
  
  const cached = await db.aiOutput.findUnique({ where: { cacheKey } });
  if (cached) return cached.content;
  
  const model = tier === 'pro' ? PRO_MODEL : REGULAR_MODEL;
  const text = sectionId 
    ? await getSectionText(bookId, sectionId) 
    : await getBookText(bookId);
  
  const explainer = await openrouter.chat({ model, prompt: buildPrompt(text, language) });
  
  await db.aiOutput.create({
    data: { ...cacheKey, content: explainer, cost: explainer.cost }
  });
  return explainer;
}
```

### Pattern 3: Tiered AI Provider Abstraction

**What:** A single `ai-orchestrator` service selects the appropriate model/provider based on user tier, content type, and admin configuration. Regular and Pro users hit different models transparently.

**When to use:** When serving multiple user tiers with different quality/cost expectations from the same endpoints.

**Trade-offs:**
- **Pros:** Clean separation of tier logic from feature code; easy to swap models without touching explainer/tts services; A/B testing new models per tier.
- **Cons:** Adds indirection; configuration drift possible if tier config and prompts get out of sync.

**Example:**
```typescript
// server/ai/tier-config.ts
export const MODEL_CONFIG = {
  explainer: {
    regular: { provider: 'openrouter', model: 'google/gemini-flash-1.5' },
    pro: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' }
  },
  tts: {
    regular: { provider: 'fal-ai', model: 'fal-ai/playai-tts' },
    pro: { provider: 'elevenlabs', model: 'eleven_turbo_v2_5' }
  }
} as const;

// server/services/ai-orchestrator.ts
export async function generate<T extends 'explainer' | 'tts'>(
  type: T,
  tier: 'regular' | 'pro',
  payload: T extends 'explainer' ? ExplainerPayload : TtsPayload
) {
  const config = MODEL_CONFIG[type][tier];
  const provider = providers[config.provider];
  return provider.generate(config.model, payload);
}
```

### Pattern 4: Position-Based Resume (Not Scroll Percentage)

**What:** Store the user's exact reading position as a content address (e.g., paragraph index, character offset) rather than scroll percentage. Resume jumps directly to the paragraph.

**When to use:** When typography is customizable (font size, line height, margins) because scroll percentage is invalidated by layout changes.

**Trade-offs:**
- **Pros:** Position is stable across device sizes and theme changes; works with virtualized/scrolled content; enables "jump to paragraph N" deep linking.
- **Cons:** Requires a stable content-to-DOM mapping; reflowed EPUBs need paragraph ID stability.

**Example:**
```typescript
// types/reader.ts
interface ReadingPosition {
  bookId: string;
  paragraphIndex: number;   // nth paragraph in the book
  charOffset: number;       // character offset within paragraph
  tocSectionId?: string;    // which TOC section
}

// hooks/use-reader.ts
function savePosition(bookId: string, position: ReadingPosition) {
  // Debounced save to server
  api.post('/api/reader/position', { bookId, position });
}
```

---

## Data Flow

### Upload Flow

```
User drops EPUB
    ↓
Client: Upload component validates file type, size
    ↓
API Route: POST /api/books/upload
    ↓
Library Service: Compute MD5 hash
    ↓
Database: Check epub_files for existing MD5
    ├─ EXISTS → Grant user_book_access, return existing book
    └─ NEW → EPUB Processor parse + convert to TXT
              ↓
         File Storage: Save EPUB + TXT files
              ↓
         Database: Create epub_file record, grant access
              ↓
         Return book metadata to client
```

### Reader Resume Flow

```
User opens book
    ↓
Client: Fetch last ReadingPosition for (userId, bookId)
    ↓
API Route: GET /api/reader/position?bookId=...
    ↓
Reader Service: Return { paragraphIndex, charOffset, tocSectionId }
    ↓
Client: Virtualized list scrolls to paragraphIndex,
        applies charOffset highlight
```

### Explainer Request Flow

```
User clicks "Explain this to me" (book or section)
    ↓
Client: POST /api/explain { bookId, sectionId?, language, tier }
    ↓
API Route: Auth check + rate limit
    ↓
Explainer Service: Compute content hash of target text
    ↓
Database: SELECT ai_outputs WHERE (hash, language, 'explainer', tier)
    ├─ CACHE HIT → Return cached explainer immediately
    └─ CACHE MISS → AI Orchestrator → OpenRouter
                        ↓
                   Store result in ai_outputs
                        ↓
                   Return explainer to client
```

### TTS Request Flow

```
User clicks "Listen to this" (book or section)
    ↓
Client: POST /api/audio { bookId, sectionId?, language, tier }
    ↓
API Route: Auth check
    ↓
TTS Service: Compute content hash, check cache
    ├─ CACHE HIT → Return existing audio URL
    └─ CACHE MISS → AI Orchestrator → ElevenLabs/fal.ai
                        ↓
                   Audio file stored in File Storage
                        ↓
                   Record stored in ai_outputs (with audioUrl)
                        ↓
                   Return audio URL to client
```

### Admin User Role Change Flow

```
Admin updates user role in Admin Panel
    ↓
Client: PATCH /api/admin/users/:id { role: 'pro' }
    ↓
API Route: Admin role guard (403 if not admin)
    ↓
Admin Service: Update user role in database
    ↓
Auth Service: Invalidate session/cache for that user
    ↓
User's next request uses new tier model selection
```

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|------------------------|
| 0-1k users | Monolithic Next.js app with local SQLite + filesystem storage. AI calls synchronous (with reasonable timeouts). Single server instance fine. |
| 1k-100k users | SQLite → PostgreSQL. File storage → S3/R2/MinIO. Redis for session cache + AI output hot cache. AI calls move to background jobs (queue with Bull/Redis) for TTS especially. Add CDN for static assets and audio files. |
| 100k+ users | Split AI generation service into separate worker processes/Containers. Consider read replicas for library queries. Partition `ai_outputs` by content type. Evaluate dedicated TTS infrastructure (self-hosted or bulk contracts with providers). |

### Scaling Priorities

1. **First bottleneck: AI API rate limits and costs.** TTS generation is expensive and slow. Fix: background queue, aggressive caching, tier-based model selection (cheaper models for Regular users).
2. **Second bottleneck: File storage and audio delivery.** Audio files are large. Fix: object storage (R2/S3) + CDN. Pre-generate popular content.
3. **Third bottleneck: Database reads on Personal Library.** Every page load queries user's books. Fix: Redis cache of user's book list; indexed `user_book_access` query.

---

## Anti-Patterns

### Anti-Pattern 1: Storing AI Outputs Only in External Provider Dashboards

**What people do:** Rely on OpenRouter/ElevenLabs history as the "cache" and regenerate on every request.
**Why it's wrong:** No deduplication across users; no cost control; vendor lock-in; cannot serve cached content if provider is down.
**Do this instead:** Always store AI outputs in your own database with composite cache keys. Treat external APIs as compute, not storage.

### Anti-Pattern 2: Scroll-Percentage-Based Reading Position

**What people do:** Store `scrollPercent: 0.47` as the reading position.
**Why it's wrong:** Breaks completely when user changes font size, device orientation, or theme. Resume position drifts with every layout change.
**Do this instead:** Store content-based positions (paragraph index + character offset). Map to DOM on render.

### Anti-Pattern 3: Per-User Book Duplication

**What people do:** Each upload creates a new `books` row with user_id FK, even for identical files.
**Why it's wrong:** N copies of the same EPUB and TXT waste storage. AI outputs generated N times instead of once.
**Do this instead:** Universal Library with MD5 dedup + access grants. Same book = same row.

### Anti-Pattern 4: Synchronous TTS in Request Handler

**What people do:** `await elevenlabs.generate(...)` directly in the API route.
**Why it's wrong:** TTS takes 10-60 seconds. HTTP request times out. Server thread blocked. Bad UX (user stares at spinner).
**Do this instead:** Return 202 Accepted immediately. Queue the job. Client polls or uses SSE/WebSocket for completion. Serve cached audio instantly on subsequent requests.

### Anti-Pattern 5: Storing Raw EPUB Content in Database

**What people do:** `BLOB` column in SQLite/PostgreSQL for EPUB files.
**Why it's wrong:** Bloated database backups; poor streaming performance; database becomes I/O bottleneck.
**Do this instead:** Store files on filesystem (dev) or object storage (prod). Database stores metadata + file path/URL only.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|-------------------|-------|
| OpenRouter | REST API via `fetch` with retries, streaming optional | Rate limits vary by model. Track usage per tier. Retry with exponential backoff. |
| ElevenLabs | REST API for TTS generation, streaming for playback | API key per tier config. Voice selection per language. Long text requires chunking. |
| fal.ai | REST API via `@fal-ai/client` or raw fetch | Often faster/cheaper than ElevenLabs for Regular tier. May have different voice options. |
| File Storage | Abstracted interface — local fs (dev) or R2/S3 (prod) | Start with local. Swap by changing one config file. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|--------------|-------|
| Client ↔ API Routes | HTTP/JSON | Next.js App Router conventions. Typed via shared Zod schemas. |
| API Routes ↔ Services | Direct function calls | Services are plain async functions, not microservices. Keeps v1 simple. |
| Services ↔ Database | Prisma ORM | Single Prisma client. Transactions for multi-table ops (upload, access grant). |
| Services ↔ AI Providers | REST API with timeout + retry | Wrap in circuit breaker after v1. Log all API costs. |
| Services ↔ File Storage | Abstracted interface | `readFile`, `writeFile`, `getUrl` — implementation swapped via config. |

---

## Suggested Build Order

The architecture has clear dependencies between components. Build in this order:

| Phase | Component | Why First |
|-------|-----------|-----------|
| 1 | Database schema + Auth + RBAC | Foundation everything else depends on |
| 2 | EPUB Processor + Universal Library | Core asset pipeline; without this, no books exist |
| 3 | Personal Library + Upload Flow | User-facing value; users can see and upload books |
| 4 | Reader + TOC + Position Tracking | Core reading experience |
| 5 | Bookmarks + Highlights | Annotations layer (depends on Reader position system) |
| 6 | Explainer generation + caching | First AI feature; caching is critical |
| 7 | TTS generation + caching | Second AI feature; shares cache pattern with Explainer |
| 8 | Admin Panel | Depends on all other components existing to manage |

**Critical path:** Database → EPUB Processor → Library → Reader → AI features. Admin panel can be built in parallel with AI features once auth is solid.

---

## Sources

- [Next.js App Router Architecture](https://nextjs.org/docs/app/building-your-application/routing)
- [Better Auth RBAC Documentation](https://www.better-auth.com/docs/plugins/admin)
- [OpenRouter API Reference](https://openrouter.ai/docs)
- [ElevenLabs API Documentation](https://elevenlabs.io/docs/api-reference)
- [fal.ai Documentation](https://fal.ai/docs)
- [Prisma Relations Guide](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations)
- "Position-based reading resume" — learned from Kindle, Apple Books, and Readium implementations
- "Universal Library pattern" — inspired by Calibre library deduplication and Plex media server metadata sharing

---
*Architecture research for: AI-Powered Ebook Reading Platform*
*Researched: 2026-05-06*
