# Feature Research

**Domain:** AI-powered ebook reader with comprehension assistance
**Researched:** 2026-05-06
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|-------------|------------|-------|
| EPUB file upload & reading | Standard ebook format; users have existing libraries | MEDIUM | Requires EPUB parsing (jszip + epubjs or similar), TOC extraction, chapter navigation |
| Rich Table of Contents (ToC) | Users expect to jump between chapters/sections instantly | LOW | Parse NCX/nav from EPUB; hierarchical display |
| Bookmarking | Every reader app has this; users lose trust without it | LOW | Per-user, per-book position + named bookmarks |
| Reading position resume ("Continue reading") | Users switch devices/sessions constantly | LOW | Store last-read location per user per book |
| Multiple reading themes (light / dark / sepia) | Expected since Kindle (2010); eye strain is real | LOW | CSS theme switching; sepia requires careful color choices |
| Typography controls (font size, line height, font family) | Accessibility requirement; personal preference | LOW | CSS custom properties + localStorage persistence |
| Text highlighting | Active reading is standard behavior; users expect to mark passages | MEDIUM | Requires text selection handling, range storage, highlight rendering overlay |
| Basic TTS / read-aloud | Speechify and ElevenReader have normalized this expectation | MEDIUM | Web Speech API as fallback; premium voices via ElevenLabs/fal.ai |
| Search within book | Finding specific passages is fundamental | MEDIUM | Full-text index of converted TXT; simple keyword search |
| Personal library / bookshelf | Users need to see and organize their books | LOW | Grid/list view with cover thumbnails, reading progress indicators |
| User authentication | Cannot have a personal library without accounts | LOW | OAuth + email/password; role-based access from day one |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Explainers (book-level & section-level)** | Core unique value prop: NOT summaries, but contextual explanations that deepen understanding. Addresses the founder's original pain point of recovering comprehension from skimmed books. | MEDIUM | OpenRouter integration; prompt engineering critical; cached per (content, language) |
| **Universal Library with MD5 deduplication** | Same EPUB = same book for all users. Upload once, everyone benefits from cached AI outputs. Massive cost efficiency. | LOW | MD5 hash on upload; check before storing; grant access if exists |
| **Multilingual explainer generation** | Language learners (e.g., Vietnamese reader learning data science in English) get explanations in their native language. Academics working with foreign texts get support. | MEDIUM | Same explainer prompt, different target language; cached independently |
| **Tiered AI quality (Regular vs Pro)** | Regular users get cost-effective models (GPT-4o-mini, etc.); Pro users unlock higher-fidelity models and premium TTS voices. Sustainable unit economics. | MEDIUM | OpenRouter model selection per tier; admin-configurable |
| **AI-generated TTS audiobook (full book + per section)** | ElevenLabs-quality narration for any EPUB. Not just robotic reading, but expressive audio. Cached so second user pays zero marginal cost. | HIGH | ElevenLabs/fal.ai integration; audio file storage; streaming playback; chunking for long texts |
| **Global caching of all AI outputs** | "Generate once, serve many." All Explainers and audio cached in Universal Library by (content_hash, language). Makes unit economics viable. | LOW | Database cache table; check before API call; TTL or indefinite |
| **Admin-managed LLM prompts** | Admin can tweak explainer prompts, experiment with prompting strategies, A/B test without code deploys. Operational agility. | LOW | Prompt templates stored in DB; versioned; admin UI for editing |
| **Beautiful bookshelf browsing experience** | Visual delight matters for retention. Cover grids, reading progress bars, recently read, currently reading. | MEDIUM | Cover extraction from EPUB; responsive grid; skeleton loaders |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **AI summaries** | Users ask for "summarize this book" | Dilutes the core value prop; summaries are commoditized (every AI tool does this); "Explainers" are intentionally different — they teach, not compress | Build Explainers only; position against summary tools explicitly |
| **Social features (sharing highlights, following friends)** | "It would be cool to share quotes" | Violates core design principle of deep, distraction-free reading; massive scope expansion (feeds, notifications, privacy); no validated demand | Keep reading private; defer social to v2+ if ever |
| **In-app ebook store / marketplace** | "Can I buy books here?" | Legal/licensing nightmare; competes with Amazon/Kobo directly; completely different business model | Support user-uploaded EPUBs only; no store |
| **PDF / DOCX / MOBI support** | "I have PDFs too" | PDF parsing is a completely different problem (layout vs. reflowable text); MOBI is deprecated; scope constraint is strategic | EPUB only for v1; explicit out-of-scope |
| **Real-time collaborative annotation** | "Can I read with a study group?" | WebSocket infrastructure, conflict resolution, presence indicators — massive complexity; not validated use case | Single-user annotations only; collaborative is v2+ |
| **Offline reading / PWA** | "I want to read on planes" | Service workers, local storage, sync conflicts, background downloads — significant engineering | Web-first; offline deferred to v2 |
| **Semantic search across entire library** | "Can I search all my books at once?" | Requires vector DB, embeddings, chunking strategy — complex and expensive; full-text within a single book is sufficient for v1 | In-book keyword search for v1; semantic search deferred |
| **Self-serve subscription billing** | "I want to upgrade to Pro myself" | Stripe integration, pricing pages, cancellation flows, tax compliance — significant scope | Admin-managed role upgrades for v1; defer billing infrastructure |
| **Highlight export to Notion/Obsidian/Readwise** | "I want my highlights elsewhere" | Per-integration APIs, OAuth, sync logic, format mapping — integration treadmill | Simple in-app highlight viewing; export as basic text/CSV if needed |
| **AI chatbot sidebar while reading** | "Can I ask questions about the book?" | Open-ended conversational UI is hard to scope; easily produces hallucinations; distracts from reading flow | Section-level Explainers cover the 80% use case; chat is v2+ |

## Feature Dependencies

```
[User Authentication]
    └──requires──> [Role-Based Access Control]
                       └──requires──> [Admin Panel]

[EPUB Upload]
    └──requires──> [EPUB to TXT Conversion]
                       └──requires──> [MD5 Deduplication]
                           └──requires──> [Universal Library]

[Universal Library]
    └──enables──> [Explainer Caching]
    └──enables──> [Audio Caching]
    └──requires──> [Database Schema]

[Explainers]
    └──requires──> [OpenRouter Integration]
    └──requires──> [Explainer Caching]
    └──enhanced_by──> [Tiered AI Quality]

[TTS Audio Generation]
    └──requires──> [ElevenLabs / fal.ai Integration]
    └──requires──> [Audio Caching]
    └──enhanced_by──> [Tiered AI Quality]

[Reader View]
    └──requires──> [EPUB Rendering Engine]
    └──enhanced_by──> [Bookmarks]
    └──enhanced_by──> [Highlights]
    └──enhanced_by──> [Reading Position Resume]

[Personal Library]
    └──requires──> [User Authentication]
    └──requires──> [EPUB Upload]
    └──enhanced_by──> [Beautiful Bookshelf]

[Admin Panel]
    └──requires──> [Role-Based Access Control]
    └──manages──> [LLM Prompts]
    └──manages──> [User Roles]
    └──manages──> [Universal Library Books]
```

### Dependency Notes

- **Explainers require OpenRouter Integration:** Explainers are AI-generated; OpenRouter provides model abstraction and tiered access.
- **TTS requires ElevenLabs / fal.ai Integration:** Web Speech API is a fallback but not a differentiator; premium TTS requires external API.
- **Universal Library enables caching:** Without deduplication, caching AI outputs per-user is wasteful. MD5 dedup makes the economics work.
- **Tiered AI Quality enhances both Explainers and TTS:** Same mechanism (model/voice selection) benefits both features.
- **Reader View enhanced by Bookmarks/Highlights:** Core reading is usable without them, but engagement drops significantly.
- **Admin Panel conflicts with rapid iteration if over-built:** Keep admin simple (CRUD tables) to avoid getting bogged down.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the concept.

- [ ] **User authentication with roles** — Regular, Pro, Admin. Admin-managed upgrades for v1.
- [ ] **EPUB upload with MD5 deduplication** — Core mechanic. Upload, hash, check Universal Library, grant access.
- [ ] **EPUB to TXT conversion** — Required for AI processing pipeline.
- [ ] **Personal Library bookshelf** — Grid of books user has access to. Basic but functional.
- [ ] **Reader view with themes & typography** — Light/dark/sepia, font controls. Solid baseline reading experience.
- [ ] **Table of Contents navigation** — Hierarchical chapter/section list.
- [ ] **Reading position resume** — Remember where user left off.
- [ ] **Book-level "Explain this to me"** — First AI feature. Generates explainer in user's preferred language.
- [ ] **Explainer caching per (content, language)** — Critical for cost control.
- [ ] **Per-user language preference** — Drives explainer generation language.
- [ ] **Admin panel for user roles & prompt management** — Operational necessity.

### Add After Validation (v1.x)

Features to add once core is working and users are engaging.

- [ ] **Section-level Explainers** — More granular than book-level; high user value but requires careful UX (where to place the button).
- [ ] **Bookmarks & Highlights** — Table stakes for reader engagement; adds meaningful complexity to reader view.
- [ ] **TTS audio generation** — High engineering effort; validate Explainers first before investing.
- [ ] **Audio caching** — Only matters once TTS exists.
- [ ] **Search within book** — Useful but not critical for initial comprehension value prop.
- [ ] **Beautiful bookshelf with cover extraction** — Visual polish that improves retention.

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Offline reading / PWA** — Significant engineering; web-first is validated first.
- [ ] **PDF / DOCX support** — Different parsing problem entirely.
- [ ] **Semantic search across library** — Vector DB, embeddings, significant infrastructure.
- [ ] **AI chatbot / Q&A while reading** — Open-ended; hard to scope; risk of hallucinations.
- [ ] **Social features / sharing** — Explicitly anti-feature for v1; reconsider only with strong signal.
- [ ] **Native mobile app** — Web-first strategy; mobile is expansion.
- [ ] **Self-serve billing / subscription tiers** — Admin-managed is sufficient until scale.
- [ ] **Highlight export integrations** — Integration treadmill; defer until users demand specific platforms.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|-----------|---------------------|----------|
| User auth + roles | HIGH | LOW | P1 |
| EPUB upload + MD5 dedup | HIGH | MEDIUM | P1 |
| Personal Library bookshelf | HIGH | LOW | P1 |
| Reader view (themes, typography) | HIGH | MEDIUM | P1 |
| ToC navigation | HIGH | LOW | P1 |
| Reading position resume | HIGH | LOW | P1 |
| Book-level Explainers | HIGH | MEDIUM | P1 |
| Explainer caching | HIGH | LOW | P1 |
| Language preference | HIGH | LOW | P1 |
| Admin panel (basic) | MEDIUM | LOW | P1 |
| Section-level Explainers | HIGH | MEDIUM | P2 |
| Bookmarks & Highlights | HIGH | MEDIUM | P2 |
| Search within book | MEDIUM | MEDIUM | P2 |
| TTS audio generation | HIGH | HIGH | P2 |
| Audio caching | MEDIUM | LOW | P2 |
| Beautiful bookshelf | MEDIUM | MEDIUM | P2 |
| Tiered AI quality config | MEDIUM | LOW | P2 |
| Admin prompt management | MEDIUM | LOW | P2 |
| Offline / PWA | MEDIUM | HIGH | P3 |
| PDF support | LOW | HIGH | P3 |
| Semantic search | MEDIUM | HIGH | P3 |
| AI chatbot sidebar | LOW | HIGH | P3 |
| Social features | LOW | HIGH | P3 |
| Native mobile app | MEDIUM | HIGH | P3 |
| Self-serve billing | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when core is validated
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | ElevenReader | Speechify | Readwise Reader | NotebookLM | Our Approach |
|---------|-------------|-----------|-----------------|------------|--------------|
| EPUB reading | Yes | Yes | Yes | No (sources only) | Yes — core feature |
| PDF reading | Yes | Yes | Yes | Yes | **No — v1 scope constraint** |
| TTS / read aloud | Yes (premium voices) | Yes (premium voices) | No | Yes (Audio Overviews) | Yes — ElevenLabs/fal.ai |
| AI explanations | No | No | No (AI digest in beta) | Yes (Q&A + Overviews) | **Yes — Explainers (not summaries)** |
| Bookmarks | Yes | Yes | Yes | N/A | Yes |
| Highlights | Yes | Yes | Yes | N/A | P2 (v1.x) |
| Reading themes | Yes | Yes | Yes | N/A | Yes (light/dark/sepia) |
| Multilingual support | Yes (32+ languages) | Yes (many languages) | No | Yes | Yes — core differentiator |
| AI caching / shared library | No | No | No | No | **Yes — Universal Library** |
| Tiered AI quality | No | No (one tier) | No | No | **Yes — Regular vs Pro** |
| Admin prompt management | N/A | N/A | N/A | N/A | **Yes — operational agility** |
| Offline reading | Yes (app) | Yes (app) | Yes | No | **No — web-first v1** |
| Social/sharing | No | No | Yes (highlights sync) | Yes (sharing) | **No — anti-feature for v1** |

### Competitor Insights

- **ElevenReader** is the closest direct competitor: EPUB/PDF reader + premium TTS. They do NOT do AI explanations. Their focus is audio consumption. We differentiate with Explainers + multilingual + caching.
- **Speechify** is TTS-first, reading-second. 55M+ users but the reading experience is secondary. Their AI features are voice-cloning and podcasts, not comprehension assistance.
- **Readwise Reader** is for power readers who highlight and sync. Their AI "digest" is a recent addition, not core. No TTS. Different audience.
- **NotebookLM** is research-focused, not leisure reading. Creates "Audio Overviews" (podcast-style summaries) from sources. Does not read EPUBs as books. Different use case entirely.
- **No competitor combines:** EPUB reading + AI explanations + premium TTS + multilingual + shared caching. This intersection is our open space.

## Sources

- ElevenReader product page (elevenreader.io) — feature set, positioning, App Store reviews
- Speechify homepage (speechify.com) — feature set, user count, positioning
- Readwise Reader (readwise.io/read) — feature set, target audience
- NotebookLM (notebooklm.google.com) — AI audio overviews, Q&A features
- NaturalReader (naturalreaders.com) — TTS feature comparison
- Kindle / Apple Books / Kobo — baseline ebook reader feature expectations
- Founder context from PROJECT.md — original pain points, target users (language learners, academics)

---
*Feature research for: AI-powered ebook reader with comprehension assistance*
*Researched: 2026-05-06*
