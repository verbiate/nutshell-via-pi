# BusyReader

## What This Is

An AI-powered ebook web app that helps readers deeply understand books through AI-generated "Explainers" (never called "summaries") at both book and section levels, text-to-speech audio generation, and multilingual support. Built around a Universal Library concept where books are deduplicated by MD5 hash and all AI-generated content (Explainers and audio) is cached and shared across every user with access to that book.

Users upload EPUB files, which are hashed and checked against the Universal Library. If new, the book is converted to TXT, stored, and the uploader is granted access. If already present, the uploader simply gains access to the existing copy. From their Personal Library ("My Library"), users can read with excellent typography, navigate via a rich Table of Contents, and request Explainers or audio in their preferred language — all cached globally after first generation.

## Core Value

Any user can upload an EPUB and immediately receive AI-powered explanations in their preferred language, plus listen to audiobook-style audio, with everything cached so it only needs to be generated once for all readers.

## Requirements

### Validated

- ✅ User authentication with role-based access (Regular, Pro, Admin) — Phase 1
- ✅ EPUB upload with MD5 hash deduplication against the Universal Library — Phase 1
- ✅ EPUB to TXT conversion for downstream AI processing — Phase 1
- ✅ Personal Library ("My Library") showing only books the user has access to — Phase 1
- ✅ Admin panel for managing user roles, Universal Library books, and LLM prompt content — Phase 1
- ✅ Per-user language preference stored at upload time (LANG-03) — Phase 1
- ✅ Full-screen EPUB reader with excellent typography — Phase 2
- ✅ Reader supports three themes (light, dark, sepia) with instant switching — Phase 2
- ✅ Hierarchical Table of Contents navigation in reader — Phase 2
- ✅ Content-based reading position persistence (paragraph + char offset) — Phase 2
- ✅ Book-level "Explain this to me" via OpenRouter with SSE streaming — Phase 3
- ✅ Section-level (ToC entry) "Explain this to me" with contextual grounding — Phase 3
- ✅ Explainer caching per (content_hash, language, content_type, tier) — Phase 3
- ✅ Per-user language preference for Explainer generation (13 languages) — Phase 3

### Active

- [ ] Selected passage "Explain this to me" for arbitrary text selections — Phase 4
- [ ] TTS audio generation for books and sections via ElevenLabs and fal.ai — Phase 5
- [ ] Audio caching per (content_hash, language, voice_id, model) in the Universal Library — Phase 5
- [ ] Per-user language preference driving TTS generation — Phase 5
- [ ] Beautiful bookshelf experience for browsing Personal Library
- [ ] Bookmarks at any position — Phase 4
- [ ] Text highlighting within books — Phase 4
- [ ] Full-text search within current book — Phase 4
- [ ] View list of all generated Explainers for a book — Phase 4

### Out of Scope

- **Native mobile app (iOS/iPad)** — Web-first for v1; mobile app is a v2 consideration.
- **PDF, DOCX, or other formats** — EPUB only for v1 to constrain scope.
- **Social features** — No sharing, comments, reviews, or community features in v1.
- **Real-time collaboration** — Single-user reading and annotation only.
- **Offline reading / PWA** — Requires service worker and local storage; defer to v2.
- **In-app payment / subscription tiers** — Role assignments handled via Admin panel for v1; no self-serve billing.
- **Semantic search across library** — Full-text search within a book may come later; universal semantic search is out of scope.

## Context

The project is motivated by the founder's personal experience using LLMs to recover understanding from books that were only skimmed or listened to in noisy environments. Through conversations with others, the need expanded to helping language learners (e.g., a Vietnamese reader learning data science from English books) and academics working with dense literature. The core insight is that LLMs are uniquely valuable for making large quantities of text comprehensible — but only if the experience is seamless, beautifully designed, and cost-efficient through caching.

Key design principles:
- **Never call Explainers "summaries"** — they are a distinct product concept.
- **Universal Library is invisible to non-admins** — users only ever see their Personal Library.
- **Generate once, serve many** — All AI outputs (Explainers, audio) are cached in the Universal Library by (content, language) to minimize cost and latency.
- **Tiered AI quality** — Regular users get cost-effective models; Pro users unlock higher-fidelity models for audio and Explainers.

## Constraints

- **Platform**: Web application only for v1. No native mobile.
- **LLM Provider**: OpenRouter for abstraction across model providers.
- **TTS Providers**: ElevenLabs and fal.ai endpoints (admin-configurable).
- **Book Format**: EPUB only for v1.
- **Book Identifier**: MD5 hash of the EPUB file contents, used as the primary key in the `epub_files` table.
- **Budget**: AI generation costs must be controlled via caching and model tiering.

## Key Decisions

| Decision | Rationale | Outcome |
| --- | --- | --- |
| OpenRouter for LLM abstraction | Avoid vendor lock-in; easy to swap models for Regular vs Pro tiers | Configured in Phase 3 with SSE streaming, tiered model selection, and cache-first orchestration |
| Web-first, mobile later | Faster to ship, broader reach, easier iteration | - Pending |
| Explainers cached per (content, language) | Minimizes API costs; content is language-agnostic until generation | Implemented in Phase 3 with SHA-256 hash + composite unique index |
| MD5 hash as book unique ID | Simple, deterministic deduplication; same book = same hash | Implemented in Phase 1 with streaming hash |
| Admin-managed roles (no self-serve billing) | Defers payment infrastructure; roles adjusted manually for v1 | Implemented in Phase 1 with audit logging |
| Google OAuth for authentication | Simpler than email/password; Better Auth supports it natively | Implemented in Phase 1 with Better Auth + Prisma adapter |
| TTS streams sections on-demand; full-book download is Pro-only | Cost control — streaming avoids paying for unlistened content; download is value-add for Pro | Architecture designed in Phase 1, implementation pending Phase 5 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-07 after Phase 3 completion*
