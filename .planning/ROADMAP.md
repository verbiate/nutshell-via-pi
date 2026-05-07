# Roadmap: BusyReader

**Project:** busyreader-via-pi
**Created:** 2026-05-06
**Derived from:** REQUIREMENTS.md v1 (47 requirements)
**Coverage:** 100% — every v1 requirement mapped to exactly one phase

---

## Phase 1: Foundation

**Goal:** Users can authenticate, upload EPUBs, and admins can manage the system.

**Status:** ✅ COMPLETE — All 5 plans executed and verified. 19/19 requirements verified.

**Completed:** 2026-05-07
**Verification:** `.planning/phases/01-foundation/01-VERIFICATION.md` (passed, 19/19)

**Requirements:**
| ID | Requirement |
| --- | --- |
| AUTH-01 | User can sign up and log in via Google OAuth |
| AUTH-02 | User session persists across browser refresh |
| AUTH-03 | User can log out from any page |
| AUTH-04 | Users have one of three roles: Regular, Pro, or Admin |
| AUTH-05 | Role assignment is managed by Admins only |
| LIB-01 | User can upload an EPUB file from their device |
| LIB-02 | System computes MD5 hash of uploaded EPUB for deduplication |
| LIB-03 | System checks MD5 against `epub_files` table; if match, grants access to existing book |
| LIB-04 | If no MD5 match, EPUB is converted to TXT, both stored, and uploader granted access |
| LIB-05 | User sees only books they have access to in "My Library" |
| LIB-06 | Admin can view all books in the Universal Library |
| ADM-01 | Admin can view a list of all registered users | ✅ 01-04 |
| ADM-02 | Admin can change any user's role (Regular / Pro / Admin) | ✅ 01-04 |
| ADM-03 | Admin can view all books in the Universal Library | ✅ 01-04 |
| ADM-04 | Admin can edit the LLM prompt template for book-level Explainers | ✅ 01-04 |
| ADM-05 | Admin can edit the LLM prompt template for section-level Explainers | ✅ 01-04 |
| ADM-06 | Admin actions are audited (who, what, when, old/new values) | ✅ 01-04 |
| ADM-07 | Admin routes require server-side role validation on every request | ✅ 01-04 |
| LANG-03 | System detects and stores the book's original language at upload time |

**Success Criteria (observable user behaviors):**
1. A new visitor can click "Sign in with Google," authorize, and land on a personalized dashboard within 5 seconds.
2. A user can drag an EPUB onto an upload zone and see the book appear in "My Library" within 10 seconds.
3. Uploading the exact same EPUB file a second time does not create a duplicate; the user simply gains access to the existing book.
4. An Admin can navigate to `/admin`, see a list of all users, change a user's role from Regular to Pro, and the change is reflected immediately in the user's session.
5. An Admin can view every book in the Universal Library, including books they did not upload.

**Research Flags:**
- EPUB parsing robustness with real-world test corpus (20+ EPUBs from Project Gutenberg, Calibre outputs, modern publishers).
- Language detection accuracy on multilingual and technical content.
- `@likecoin/epub-ts` edge case handling for broken XML or malformed HTML.

---

## Phase 2: Core Reading Experience

**Goal:** Users can read books with excellent typography, navigate via ToC, and resume where they left off.

**Requirements:**
| ID | Requirement |
| --- | --- |
| READ-01 | User can open a book and view it with excellent typography |
| READ-02 | Reader supports three themes: light, dark, and sepia |
| READ-03 | Reader displays hierarchical Table of Contents from EPUB |
| READ-04 | Clicking a ToC entry navigates to that section in the reader |
| READ-05 | User's reading position (paragraph index + char offset) is saved and resumed on return |

**Success Criteria (observable user behaviors):**
1. A user can click any book in "My Library" and the reader opens with readable typography within 2 seconds.
2. A user can toggle between light, dark, and sepia themes with a single click and the change applies instantly without page reload.
3. A user can open the Table of Contents sidebar, see a hierarchical chapter/section list, click any entry, and jump directly to that section.
4. A user can close a book at paragraph 147, character 23, reopen it two days later, and resume at the exact same position.
5. The reading experience feels as polished as Apple Books or Kindle — no layout shift, no flash of unstyled content, smooth scrolling.

**Research Flags:**
- `react-reader` wraps unmaintained `epubjs`; validate stability or build custom React wrapper (~200 LOC fallback).
- Content-based position tracking (paragraph index + char offset) must survive theme and font-size changes.

**Plans:**
| Plan | Status | Summary |
| --- | --- | --- |
| 02-01: Reader Infrastructure | ✅ Complete (2026-05-07) | UserBookPosition model, (reader) route group, ThemeProvider with sepia, Open Reader navigation. Commits: `30822a1`, `5003111`, `72490e3` |
| 02-02 | Pending | - |
| 02-03 | ✅ Complete (2026-05-07) | ToC panel (left Sheet + ScrollArea), ThemeToggle (mount-gated, light→sepia→dark), ReaderSkeleton (5 skeleton lines), ReaderError (UI-SPEC copy). READ-01/02/03/04 covered. Commits: `20d8c6d`, `ce4fe56`, `d8f53c9`, `a2b7c36` |

---

## Phase 3: AI Explainers

**Goal:** Users can request AI-generated Explainers at book and section levels, cached globally by (content, language).

**Requirements:**
| ID | Requirement |
| --- | --- |
| EXP-01 | User can request a book-level "Explain this to me" for any book in their library |
| EXP-02 | User can request a section-level "Explain this to me" for any ToC entry |
| EXP-04 | Explainers are generated via OpenRouter with user-specified language preference |
| EXP-05 | System checks cache for existing Explainer matching (content_hash, language, content_type); serves cached if found |
| EXP-06 | If no cached Explainer exists, system generates, caches, then serves it |
| EXP-07 | Explainers are grounded in source text from the book's TXT conversion |
| LANG-01 | User can set a preferred language for Explainers |
| LANG-02 | Language preference is persisted to user profile |

**Success Criteria (observable user behaviors):**
1. A user can click "Explain this to me" on any book and receive a coherent AI explanation in their preferred language within 30 seconds of first request.
2. Clicking "Explain this to me" on the same book a second time loads the explanation instantly (sub-second) from cache — no spinner, no regeneration.
3. A user can click "Explain this to me" on any section in the Table of Contents and receive a contextual explanation grounded in that section's text.
4. A user can change their language preference from English to Vietnamese, request a new Explainer, and receive it in Vietnamese.
5. An Admin can edit the book-level Explainer prompt template, save it, and the next Explainer generated uses the new prompt.

**Research Flags:**
- Prompt engineering for hallucination resistance — test grounding strategy with real book content before caching architecture is locked.
- Explainer quality evaluation against real books; establish acceptance criteria for coherence and accuracy.
- Composite cache key design `(content_hash, language, content_type, tier)` validation.

---

## Phase 4: Reading Enhancements

**Goal:** Users can bookmark, highlight, search, and request passage-level Explainers.

**Requirements:**
| ID | Requirement |
| --- | --- |
| READ-06 | User can create bookmarks at any position |
| READ-07 | User can highlight text selections |
| READ-08 | User can search for text within the current book |
| EXP-03 | User can request an Explainer for a selected passage (text selection) |
| EXP-08 | User can view a list of all generated Explainers for a book |

**Success Criteria (observable user behaviors):**
1. A user can tap a bookmark button at their current position, see it saved, and later open a bookmarks list to jump back to that position.
2. A user can select a paragraph of text, click "Highlight," and the highlight persists after closing and reopening the book.
3. A user can type a keyword into a search box, see results with context snippets, and click any result to jump to that location in the book.
4. A user can select arbitrary text in the reader, click "Explain this to me," and receive an AI explanation specific to that selection.
5. A user can open an "Explainers" panel for any book and see a chronological or navigable list of all Explainers they have generated (book-level, section-level, and passage-level).

**Research Flags:**
- Text selection handling and range serialization across HTML rendering boundaries.
- Search indexing strategy for full-text keyword search within large TXT conversions.

---

## Phase 5: TTS Audio

**Goal:** Users can generate and listen to audiobook-style audio for books and sections, with tiered quality.

**Requirements:**
| ID | Requirement |
| --- | --- |
| EXP-09 | Pro users can access higher-fidelity LLM models for Explainer generation |
| TTS-01 | User can hit "play" to stream audiobook-style audio; system generates sections on-demand with a buffer |
| TTS-02 | User can request audio for a specific section |
| TTS-03 | Audio is generated via ElevenLabs (default) or fal.ai (cost-effective) endpoints |
| TTS-04 | System checks cache for existing audio matching (content_hash, language, voice_id, model); serves cached if found |
| TTS-05 | If no cached audio exists, system generates, caches, then serves it |
| TTS-06 | Pro users can access higher-fidelity voice models for audio generation |
| TTS-07 | Audio generation is queued asynchronously (202 Accepted); user polls or receives notification on completion |
| TTS-08 | Pro users can "Download" full-book audio for offline listening (pre-processes entire book, gated feature) |
| LANG-04 | TTS voice selection respects book language (not user preference) |

**Success Criteria (observable user behaviors):**
1. A user can hit "play" on any book and audio begins within seconds; the system streams sections on-demand, generating the current section + next section as a buffer.
2. Requesting audio for the same section with the same voice loads from cache instantly without triggering a new generation job.
3. A Pro user sees premium voice/model options in the audio generation UI that are not visible to Regular users.
4. A Pro user can click "Download Audio" to pre-process the entire book for offline listening; a Regular user does not see this option.
5. A user can play, pause, and scrub through generated audio with a built-in audio player that shows progress and duration.

**Research Flags:**
- TTS cost estimation accuracy with sample books of varying lengths; set hard limits before production.
- ElevenLabs vs fal.ai voice quality comparison for Regular vs Pro tier differentiation.
- Async job queue implementation (202 Accepted → poll/notify pattern) validated with slow generation jobs.

---

## Coverage Validation

| Phase | Requirements | Count |
| --- | --- | --- |
| Phase 1: Foundation | AUTH-01..05, LIB-01..06, ADM-01..07, LANG-03 | 19 |
| Phase 2: Core Reading | READ-01..05 | 5 |
| Phase 3: AI Explainers | EXP-01..02, EXP-04..07, LANG-01..02 | 8 |
| Phase 4: Reading Enhancements | READ-06..08, EXP-03, EXP-08 | 5 |
| Phase 5: TTS Audio | EXP-09, TTS-01..08, LANG-04 | 10 |
| **Total** | | **47** |

Every v1 requirement from REQUIREMENTS.md is mapped to exactly one phase. No requirements are orphaned, duplicated, or deferred without explicit Out of Scope documentation.

---

## Phase Ordering Rationale

1. **Auth and database first** — every feature depends on users, roles, and the `epub_files` schema.
2. **EPUB processing before reading** — without a working parser and deduplication pipeline, no books exist in the system.
3. **Reader before AI** — Explainers and TTS require a place to display results; the reading experience must be solid first.
4. **Explainers before TTS** — lower engineering cost, faster validation of core value prop, and shared cache architecture can be proven with text before adding file storage complexity.
5. **Background workers for AI features** — both Explainers and TTS can be slow; the async pattern (return 202, queue job, poll for completion) is established in Phase 3 and reused in Phase 5.
6. **Admin capabilities parallel to each feature** — role management, prompt editing, and cost tracking are built alongside the features they govern.

---

*Roadmap created: 2026-05-06*
*Next step: Phase 1 implementation planning*
