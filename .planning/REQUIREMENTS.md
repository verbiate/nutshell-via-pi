# Requirements: BusyReader

**Defined:** 2026-05-06
**Core Value:** Any user can upload an EPUB and immediately receive AI-powered explanations in their preferred language, plus listen to audiobook-style audio, with everything cached so it only needs to be generated once for all readers.

## v1 Requirements

### Authentication

- [ ] **AUTH-01**: User can sign up and log in via Google OAuth
- [ ] **AUTH-02**: User session persists across browser refresh
- [ ] **AUTH-03**: User can log out from any page
- [ ] **AUTH-04**: Users have one of three roles: Regular, Pro, or Admin
- [ ] **AUTH-05**: Role assignment is managed by Admins only (no self-serve billing in v1)

### Library & Upload

- [ ] **LIB-01**: User can upload an EPUB file from their device
- [ ] **LIB-02**: System computes MD5 hash of uploaded EPUB for deduplication
- [ ] **LIB-03**: System checks MD5 against `epub_files` table; if match, grants access to existing book
- [ ] **LIB-04**: If no MD5 match, EPUB is converted to TXT, both stored, and uploader granted access
- [ ] **LIB-05**: User sees only books they have access to in "My Library"
- [ ] **LIB-06**: Admin can view all books in the Universal Library

### Reading Experience

- [ ] **READ-01**: User can open a book and view it with excellent typography
- [ ] **READ-02**: Reader supports three themes: light, dark, and sepia
- [ ] **READ-03**: Reader displays hierarchical Table of Contents from EPUB
- [ ] **READ-04**: Clicking a ToC entry navigates to that section in the reader
- [ ] **READ-05**: User's reading position (paragraph index + char offset) is saved and resumed on return
- [ ] **READ-06**: User can create bookmarks at any position
- [ ] **READ-07**: User can highlight text selections
- [ ] **READ-08**: User can search for text within the current book

### AI Explainers

- [ ] **EXP-01**: User can request a book-level "Explain this to me" for any book in their library
- [ ] **EXP-02**: User can request a section-level "Explain this to me" for any ToC entry
- [ ] **EXP-03**: User can request an Explainer for a selected passage (text selection)
- [ ] **EXP-04**: Explainers are generated via OpenRouter with user-specified language preference
- [ ] **EXP-05**: System checks cache for existing Explainer matching (content_hash, language, content_type); serves cached if found
- [ ] **EXP-06**: If no cached Explainer exists, system generates, caches, then serves it
- [ ] **EXP-07**: Explainers are grounded in source text from the book's TXT conversion
- [ ] **EXP-08**: User can view a list of all generated Explainers for a book
- [ ] **EXP-09**: Pro users can access higher-fidelity LLM models for Explainer generation

### TTS Audio

- [ ] **TTS-01**: User can request audiobook-style audio for an entire book
- [ ] **TTS-02**: User can request audio for a specific section
- [ ] **TTS-03**: Audio is generated via ElevenLabs (default) or fal.ai (cost-effective) endpoints
- [ ] **TTS-04**: System checks cache for existing audio matching (content_hash, language, voice_id, model); serves cached if found
- [ ] **TTS-05**: If no cached audio exists, system generates, caches, then serves it
- [ ] **TTS-06**: Pro users can access higher-fidelity voice models for audio generation
- [ ] **TTS-07**: Audio generation is queued asynchronously (202 Accepted); user polls or receives notification on completion

### Admin Panel

- [ ] **ADM-01**: Admin can view a list of all registered users
- [ ] **ADM-02**: Admin can change any user's role (Regular / Pro / Admin)
- [ ] **ADM-03**: Admin can view all books in the Universal Library
- [ ] **ADM-04**: Admin can edit the LLM prompt template for book-level Explainers
- [ ] **ADM-05**: Admin can edit the LLM prompt template for section-level Explainers
- [ ] **ADM-06**: Admin actions are audited (who, what, when, old/new values)
- [ ] **ADM-07**: Admin routes require server-side role validation on every request

### Language & Preferences

- [ ] **LANG-01**: User can set a preferred language for Explainers
- [ ] **LANG-02**: Language preference is persisted to user profile
- [ ] **LANG-03**: System detects and stores the book's original language at upload time
- [ ] **LANG-04**: TTS voice selection respects book language (not user preference)

## v2 Requirements

### Platform

- **PLAT-01**: Native iPad app with synced reading position

### Features

- **NOTF-01**: In-app notifications for completed audio/explainer generation
- **OFFLINE-01**: Offline reading via PWA with local book storage
- **SOCIAL-01**: Share explainer excerpts with other users

### Formats

- **FORMAT-01**: Support PDF and MOBI upload

### Billing

- **BILL-01**: Self-serve subscription upgrades (Regular → Pro)

## Out of Scope

| Feature | Reason |
| --- | --- |
| Native mobile app (iOS/Android) | Web-first for v1; mobile is v2 consideration |
| PDF, DOCX, MOBI support | EPUB only for v1 to constrain scope |
| Social features (sharing, comments, reviews) | Explicitly excluded from v1 |
| Real-time collaboration | Single-user reading and annotation only |
| Offline reading / PWA | Significant engineering; defer to v2 |
| Self-serve billing | Admin-managed roles sufficient for v1 |
| Semantic search across library | Requires vector DB; defer to v2 |
| AI chatbot sidebar while reading | Open-ended, hard to scope for v1 |

## Traceability

| Requirement | Phase | Status |
| --- | --- | --- |
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 1 | Pending |
| AUTH-04 | Phase 1 | Pending |
| AUTH-05 | Phase 1 | Pending |
| LIB-01 | Phase 1 | Pending |
| LIB-02 | Phase 1 | Pending |
| LIB-03 | Phase 1 | Pending |
| LIB-04 | Phase 1 | Pending |
| LIB-05 | Phase 1 | Pending |
| LIB-06 | Phase 1 | Pending |
| READ-01 | Phase 2 | Pending |
| READ-02 | Phase 2 | Pending |
| READ-03 | Phase 2 | Pending |
| READ-04 | Phase 2 | Pending |
| READ-05 | Phase 2 | Pending |
| READ-06 | Phase 4 | Pending |
| READ-07 | Phase 4 | Pending |
| READ-08 | Phase 4 | Pending |
| EXP-01 | Phase 3 | Pending |
| EXP-02 | Phase 3 | Pending |
| EXP-03 | Phase 4 | Pending |
| EXP-04 | Phase 3 | Pending |
| EXP-05 | Phase 3 | Pending |
| EXP-06 | Phase 3 | Pending |
| EXP-07 | Phase 3 | Pending |
| EXP-08 | Phase 4 | Pending |
| EXP-09 | Phase 5 | Pending |
| TTS-01 | Phase 5 | Pending |
| TTS-02 | Phase 5 | Pending |
| TTS-03 | Phase 5 | Pending |
| TTS-04 | Phase 5 | Pending |
| TTS-05 | Phase 5 | Pending |
| TTS-06 | Phase 5 | Pending |
| TTS-07 | Phase 5 | Pending |
| ADM-01 | Phase 1 | Pending |
| ADM-02 | Phase 1 | Pending |
| ADM-03 | Phase 1 | Pending |
| ADM-04 | Phase 1 | Pending |
| ADM-05 | Phase 1 | Pending |
| ADM-06 | Phase 1 | Pending |
| ADM-07 | Phase 1 | Pending |
| LANG-01 | Phase 3 | Pending |
| LANG-02 | Phase 3 | Pending |
| LANG-03 | Phase 1 | Pending |
| LANG-04 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 45 total
- Mapped to phases: 45
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-06*
*Last updated: 2026-05-06 after initialization*
