# Project Research Summary

**Project:** busyreader-via-pi
**Domain:** AI-powered ebook reader with comprehension assistance (EPUB parsing, AI explainers, TTS audio, role-based auth)
**Researched:** 2026-05-06
**Confidence:** HIGH

## Executive Summary

BusyReader is an AI-powered ebook reader designed for deep comprehension, not passive consumption. The core value proposition is **Explainers** — AI-generated contextual explanations that teach users *why* and *how* a book matters, rather than compressing *what* happened into a summary. This addresses a validated pain point: readers who skim books and later need to recover actual understanding.

Research confirms the recommended path is a **fullstack Next.js 16 application** with SQLite (Prisma 5), Better Auth for role-based access, `@likecoin/epub-ts` for EPUB processing, and the Vercel AI SDK + OpenRouter for tiered AI access. The product differentiates through a **Universal Library** with MD5 deduplication (same book = shared AI outputs across all users), multilingual explainer generation, and tiered AI quality (Regular vs Pro). No competitor currently combines EPUB reading + AI explanations + premium TTS + multilingual support + shared caching.

The primary risks are **AI hallucination** (presented as book truth), **TTS cost explosion** without aggressive caching, and **EPUB parsing edge cases** that corrupt the reader. All three are addressable through grounding prompts in source text, composite cache keys, and defensive parsing with validation.

## Key Findings

### Recommended Stack

The research strongly recommends a modern React fullstack stack centered on Next.js 16 App Router. See [STACK.md](STACK.md) for full details including version numbers, installation commands, and alternatives considered.

**Core technologies:**
- **Next.js 16.2.5** — Fullstack framework with App Router, Server Components, and streaming SSR. Eliminates client JS for static content and provides API routes for uploads/AI calls.
- **React 19.2.6 + TypeScript 6.0.3** — Required peer of Next.js 16; React 19 improves Server Component integration. TypeScript is non-negotiable for a data-heavy domain.
- **Tailwind CSS 4.2.4** — CSS-first config (no `tailwind.config.js`), ideal for theme switching (light/dark/sepia) via CSS variables.
- **Prisma 5.22.0 + SQLite** — Best-in-class relation modeling for the complex `epub_files → books → sections → explainers → audio_files` graph. **Pinned to 5.x** — Prisma 7 removes `datasourceUrl` from the constructor and breaks runtime configuration.
- **Better Auth 1.6.9** — Framework-agnostic auth with built-in Prisma adapter, role/organization support via plugins, and admin capabilities. The modern standard over NextAuth.
- **@likecoin/epub-ts 0.6.3** — Primary EPUB engine. TypeScript-strict, 1 dependency, 970+ tests, active maintenance. Replaces unmaintained `epubjs` (last stable release 2022).
- **Vercel AI SDK + OpenRouter** — Unified streaming API with access to 300+ models, perfect for tiered AI quality.
- **ElevenLabs + fal.ai** — Premium TTS for Pro tier; fal.ai as cost-effective alternative for Regular tier.
- **@tanstack/react-query + zustand** — Server state caching (critical for explainer/audio existence checks) and lightweight client state (reader UI).

### Expected Features

See [FEATURES.md](FEATURES.md) for the full feature landscape, competitor analysis, and prioritization matrix.

**Must have (P1 — table stakes + core differentiators):**
- User authentication with roles (Regular / Pro / Admin) — admin-managed upgrades for v1
- EPUB upload with MD5 deduplication — core Universal Library mechanic
- EPUB to TXT conversion — required for AI pipeline
- Personal Library bookshelf — grid/list view of accessible books
- Reader view with themes (light/dark/sepia) and typography controls
- Table of Contents navigation — hierarchical chapter/section list
- Reading position resume — content-based (paragraph index), not scroll percentage
- Book-level "Explain this to me" — first AI feature, generates in user's preferred language
- Explainer caching per (content_hash, language) — critical for cost control
- Per-user language preference — drives explainer generation
- Admin panel (basic CRUD) — operational necessity for roles and prompt management

**Should have (P2 — adds engagement):**
- Section-level Explainers — more granular, high user value
- Bookmarks & Highlights — standard active-reading behavior
- Search within book — keyword search of converted TXT
- TTS audio generation — ElevenLabs/fal.ai integration
- Audio caching — shared across users like explainers
- Beautiful bookshelf with cover extraction — visual retention
- Tiered AI quality config — admin-managed model selection per tier

**Defer (P3 / v2+ — scope constraints):**
- Offline reading / PWA — significant engineering, web-first strategy
- PDF / DOCX / MOBI support — entirely different parsing problem
- Semantic search across library — requires vector DB and embeddings
- AI chatbot sidebar while reading — open-ended, hard to scope
- Social features / sharing — explicitly anti-feature for v1
- Self-serve subscription billing — admin-managed is sufficient until scale

### Architecture Approach

See [ARCHITECTURE.md](ARCHITECTURE.md) for system diagrams, data flows, project structure, and scaling considerations.

The architecture is a **layered monolith**: Next.js App Router client → API routes → domain services → SQLite database + file storage. Services are plain async functions (not microservices), keeping v1 simple while preserving clear boundaries for future extraction.

**Major components:**
1. **Auth Service (Better Auth + Prisma)** — Session management, RBAC (Regular/Pro/Admin), server-side role guards on every admin endpoint.
2. **EPUB Processor** — Streaming MD5 hash, parse EPUB with `@likecoin/epub-ts`, convert to TXT, validate on upload.
3. **Library Service** — Universal Library keyed by MD5 + `user_book_access` grants. Same book = same row, zero per-user duplication.
4. **Reader Service** — Position tracking (paragraph index + char offset), TOC navigation, theme management.
5. **AI Orchestrator** — Tier-based model selection (Regular vs Pro), prompt template management, provider abstraction (OpenRouter / ElevenLabs / fal.ai).
6. **Cache Service** — Composite unique keys `(content_hash, language, content_type, tier)` for all AI outputs. Prevents duplicate API calls across users.
7. **TTS Service** — Chunked text generation, audio file storage, metadata tracking. Returns 202 Accepted immediately; client polls for completion.
8. **Admin Service** — Protected routes with admin role guard, user role management, prompt configuration, Universal Library inspection.

### Critical Pitfalls

See [PITFALLS.md](PITFALLS.md) for the full catalog including recovery strategies and a "looks done but isn't" checklist.

1. **Same Book, Different Hash** — Two EPUBs with identical text but different metadata/cover compression produce different MD5 hashes, defeating deduplication. *Avoid:* Implement content-based fuzzy dedup as secondary check; store ISBN as soft-match signal; accept that some duplicates are inevitable.
2. **AI Hallucination Presented as Book Truth** — LLMs invent plot points or misattribute quotes. Users trust Explainers because the branding sounds authoritative. *Avoid:* Ground every explainer in source text (include passages in prompt); add a "confidence" UI disclaimer; store prompt context alongside cached output for auditing; use retrieval-style prompting for section explainers.
3. **TTS Cost Explosion via Cache Misses** — A 300-page novel costs $5-10 in ElevenLabs fees. Without aggressive caching, every new user triggers regeneration. *Avoid:* Cache key = `(content_hash, language, voice_id, tts_model_version)` — never user ID; pre-compute book-level audio only for v1; set hard cost limits per job; estimate cost from TXT length before generating.
4. **EPUB Parsing Edge Cases** — Self-published EPUBs have broken XML, missing manifest entries, or malformed HTML that crashes parsers. *Avoid:* Use battle-tested parser (`@likecoin/epub-ts`); wrap extraction in try/catch; validate ZIP structure on upload; test with real-world corpus (Project Gutenberg, Calibre outputs); handle encodings explicitly (force UTF-8).
5. **Multilingual TTS Generates Wrong-Language Audio** — A user sets Vietnamese preference on an English book; TTS produces gibberish. *Avoid:* Explicit language selection at upload (detect and suggest, let user override); store `book_language` separately from `user_preference_language`; validate voice compatibility before generation; cache by book language, not user preference.
6. **Admin Panel as Privilege Escalation Vector** — Weak access controls or client-side role gating expose dangerous operations. *Avoid:* Admin routes under `/api/admin/*` with middleware role validation at every layer; audit log every action (who, what, when, old/new values); require re-authentication for sensitive actions; default deny for new features.
7. **Large EPUBs Crash the Server** — A 200MB illustrated textbook read into memory for hashing/parsing causes OOM. *Avoid:* Stream MD5 computation; process chapters one at a time; reject EPUBs > 50MB for v1; store TXT as chunked records (per-chapter); run heavy processing in background workers.
8. **"Explainer" Brand Dilution** — Despite the explicit requirement, engineers unconsciously use "summary" in code, APIs, and UI. *Avoid:* Establish glossary in code reviews; name tables/endpoints explainer-first; lint user-facing strings for "summary"; train team that explainers teach, not compress.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation
**Rationale:** Everything depends on auth, the database schema, and the EPUB processing pipeline. The deduplication strategy must be designed before the first upload or data becomes un-mergeable.
**Delivers:** Database schema + Prisma client; Better Auth with RBAC; basic admin panel; EPUB processor with streaming MD5 + validation; Universal Library upload flow.
**Addresses:** User auth + roles, EPUB upload + MD5 dedup, TXT conversion, admin panel (P1 features)
**Avoids:** Same Book Different Hash, Large EPUB Crashes, Admin Panel Escalation, Universal Library Leak

### Phase 2: Core Reading Experience
**Rationale:** Users need a solid baseline reading experience before any AI features matter. Position tracking must be content-based from day one — scroll percentage is invalidated by theme/font changes.
**Delivers:** Personal Library bookshelf; Reader view with light/dark/sepia themes and typography controls; Table of Contents navigation; reading position resume (paragraph index + char offset).
**Addresses:** Personal Library, Reader view, ToC, resume position (P1 features)
**Avoids:** Reader Position Loss, Scroll-Percentage Anti-Pattern

### Phase 3: AI Explainers
**Rationale:** The core differentiator. Prompt engineering and grounding architecture must be designed before the first explainer is cached — retrofitting is nearly impossible without regenerating everything.
**Delivers:** Book-level explainer generation; explainer caching with composite keys; per-user language preference; admin-managed prompt templates; grounding in source text.
**Uses:** OpenRouter AI SDK provider, Vercel AI SDK, `@tanstack/react-query` for caching existence checks
**Implements:** AI Orchestrator, Cache Service
**Addresses:** Book-level Explainers, Explainer caching, language preference, admin prompt management (P1 features)
**Avoids:** AI Hallucination, Explainer Brand Dilution

### Phase 4: Reading Tools
**Rationale:** Bookmarks, highlights, and search add engagement but depend on the reader position system from Phase 2. Section-level explainers require careful UX (where to place the button) and are higher value than book-level alone.
**Delivers:** Bookmarks & highlights; search within book; section-level Explainers.
**Addresses:** Bookmarks & Highlights, Search within book, Section-level Explainers (P2 features)

### Phase 5: TTS Audio
**Rationale:** TTS is high engineering effort and high cost. Validate Explainers first. Audio generation is slow (10-60 seconds) and must be background-queued.
**Delivers:** ElevenLabs/fal.ai integration; audio generation with chunking; audio caching; tiered voice selection (Regular vs Pro); inline audio player with playback controls.
**Uses:** ElevenLabs SDK, fal.ai client, file storage abstraction
**Implements:** TTS Service
**Addresses:** TTS audio generation, Audio caching, Tiered AI quality (P2 features)
**Avoids:** TTS Cost Explosion, Synchronous TTS in Request Handler

### Phase 6: Polish & Scale
**Rationale:** Visual polish and operational tooling that improve retention and unit economics but are not required for core value validation.
**Delivers:** Beautiful bookshelf with cover extraction; reading progress indicators; tiered AI quality admin configuration; cost tracking dashboard; Pro badges in UI.
**Addresses:** Beautiful bookshelf, Tiered AI config (P2 features)

### Phase Ordering Rationale

- **Auth and database first** — every feature depends on users and roles. Admin panel is operational necessity, not an afterthought.
- **EPUB processing before reading** — without a working parser and deduplication pipeline, no books exist in the system.
- **Reader before AI** — Explainers and TTS require a place to display results. The reading experience must be solid before AI is layered on.
- **Explainers before TTS** — lower engineering cost, faster validation of the core value prop, and shared cache architecture can be proven with text before adding file storage complexity.
- **Background workers for AI features** — both Explainers and TTS can be slow. The architecture pattern (return 202, queue job, poll for completion) is established in Phase 3 and reused in Phase 5.
- **Admin capabilities parallel to each feature** — role management, prompt editing, and cost tracking are built alongside the features they govern rather than deferred to the end.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (EPUB Processor):** Real-world EPUB parsing robustness. The `@likecoin/epub-ts` library is HIGH confidence, but edge cases from Calibre outputs and self-published EPUBs need a test corpus validation step.
- **Phase 3 (Explainers):** Prompt engineering for hallucination resistance. The grounding strategy (retrieval-style prompting, source text inclusion) needs prototyping and evaluation against real books before caching architecture is locked.
- **Phase 5 (TTS):** Cost estimation accuracy. ElevenLabs pricing per character means book-length audio costs are highly variable. A validation step with sample books is needed before setting hard limits.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Auth + RBAC):** Better Auth + Prisma adapter is well-documented with clear RBAC patterns. HIGH confidence.
- **Phase 2 (Reader):** EPUB rendering with `react-reader` and theme switching with Tailwind CSS variables are established patterns. MEDIUM confidence due to `react-reader`'s dependency on unmaintained `epubjs`.
- **Phase 4 (Bookmarks/Highlights):** Text selection handling and range storage are solved problems in ebook reader implementations.

## Confidence Assessment

| Area         | Confidence | Notes |
| ------------ | ---------- | ----- |
| Stack        | HIGH       | All technologies are industry-standard, actively maintained, and version numbers verified from npm registry. Prisma 5.x pin is a known safe choice. |
| Features     | HIGH       | Feature landscape is well-defined with clear MVP boundary. Competitor analysis confirms open space at the intersection of EPUB + Explainers + TTS + multilingual + caching. |
| Architecture | HIGH       | Layered monolith is appropriate for v1 scale. Universal Library and AI caching patterns are proven. Scaling path to PostgreSQL + object storage is well-understood. |
| Pitfalls     | HIGH       | All pitfalls are known issues with documented prevention strategies. Several are learned from post-mortems of similar products. |

**Overall confidence:** HIGH

### Gaps to Address

- **EPUB parsing robustness:** Needs validation with a real-world test corpus (20+ EPUBs from Project Gutenberg, modern publishers, and Calibre outputs) before user-facing upload. Handle during Phase 1 implementation.
- **Prompt engineering quality:** Hallucination resistance and explainer quality depend on prompt design. Needs iterative testing with real book content during Phase 3 planning.
- **TTS cost estimation:** Per-character pricing means costs scale linearly with book length. Needs validation with sample books of varying sizes to set accurate hard limits during Phase 5.
- **react-reader maintenance risk:** Wraps unmaintained `epubjs`. The `@likecoin/epub-ts` API compatibility mitigates risk, but a custom React wrapper is a viable fallback (~200 LOC). Monitor during Phase 2.
- **Language detection accuracy:** Auto-detection libraries fail on short texts, mixed-language books, and technical content. Needs testing on a multilingual corpus during Phase 1.

## Sources

### Primary (HIGH confidence)
- `npm view` registry queries (2026-05-06) — verified all package version numbers directly from npm
- `@likecoin/epub-ts` README — performance benchmarks, Node.js export confirmation, test coverage
- `better-auth` package README — peer dependencies, Prisma adapter, plugin ecosystem, RBAC documentation
- Vercel AI SDK documentation — streaming API, structured output, provider patterns
- OpenRouter API Reference — model selection, rate limits, fallback strategies
- ElevenLabs API Documentation — TTS generation, voice selection, streaming, pricing
- Prisma Relations Guide — schema design for complex relation graphs
- Next.js App Router Architecture — route groups, Server Components, API routes

### Secondary (MEDIUM confidence)
- ElevenReader product page (elevenreader.io) — competitor feature set, positioning, TTS-first approach
- Speechify homepage (speechify.com) — 55M+ users, TTS-focused reading experience
- Readwise Reader (readwise.io/read) — power reader audience, AI digest beta feature
- NotebookLM (notebooklm.google.com) — Audio Overviews pattern, research-focused Q&A
- Kindle / Apple Books / Kobo — baseline ebook reader feature expectations, position-based resume patterns
- EPUB parsing community knowledge (Calibre, Readium) — edge cases, encoding issues, validation strategies

### Tertiary (LOW confidence / inferred)
- TTS cost management lessons from ElevenLabs developer forums — pricing variability, chunking strategies
- Admin panel security incidents from SaaS applications — role escalation patterns, CSRF on admin endpoints
- AI summarization product post-mortems — hallucination risks, brand dilution of "summary" vs "explainer"
- SQLite concurrency under write-heavy workloads — WAL mode limitations, Prisma transaction behavior

---

*Research completed: 2026-05-06*
*Ready for roadmap: yes*
