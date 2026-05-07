# Phase 3: AI Explainers - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 3-ai-explainers
**Areas discussed:** Explainer trigger & display, Generation UX pattern, Language preference, Cache key design

---

## Explainer Trigger & Display

| Option | Description | Selected |
|--------|-------------|----------|
| Book detail page trigger | "Explain" button adjacent to "Open Reader" on `/book/[id]` | ✓ |
| Reader chrome trigger | Toolbar button inside the reader for book-level explainer | (agent discretion) |
| Section-level in ToC panel | "Explain" action on each ToC entry | ✓ |
| Slide-out panel display | Reuse Sheet + ScrollArea pattern (consistent with ToC) | (agent discretion) |
| Modal display | Overlay modal for explainer text | |
| Inline display | Explainer text appears inline in the page | |
| Text selection → Explain | Right-click/context menu on selected text | (deferred to Phase 4) |

**User's choice:** Book-level on detail page, section-level in ToC panel, display is agent discretion. User explicitly wants text selection with Highlight/Explain options — noted and deferred to Phase 4 (EXP-03, READ-07).
**Notes:** User said "I trust you to use your best judgement here" on display mechanism. Suggested GSAP-style animation for the text reveal.

---

## Generation UX Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Inline SSE streaming | Word-by-word text appears as tokens arrive | ✓ |
| GSAP word-by-word fade-in | Animated cinematic reveal of streaming text | ✓ |
| Spinner + blocking wait | Show loader, display full text when complete | |
| Async poll-later | 202 Accepted, poll for completion | |

**User's choice:** "I would love to see a GSAP-style word-by-word fade in."
**Notes:** User wants a signature animated reveal, not plain streaming. This is a product differentiator moment.

---

## Language Preference

| Option | Description | Selected |
|--------|-------------|----------|
| Profile page | Standalone `/profile` page with language selector | |
| Profile modal | Modal overlay accessible from Library and Reader | ✓ |
| Per-request inline | Language picker inside each explainer request | (agent discretion - override available) |
| Default: English | All new users default to English | ✓ |
| Default: Book language | Default to the book's detected original language | |
| Default: Browser locale | Default to `navigator.language` | |

**User's choice:** Profile "page" functioning as a modal, accessible from Library and Reader views. Default language is agent discretion — captured as English in CONTEXT.md.
**Notes:** User specifically said "this 'page' may function better as a modal."

---

## Cache Key Design

| Option | Description | Selected |
|--------|-------------|----------|
| Include tier now | `(content_hash, language, content_type, tier)` | ✓ |
| Defer tier to Phase 5 | `(content_hash, language, content_type)` only | |

**User's choice:** "I don't know what this means, so I trust you to use your best judgement here."
**Notes:** Agent selected "include tier now" as the recommended option. Future-proofs EXP-09 without migration.

---

## the agent's Discretion

- Exact explainer display container (Sheet vs modal vs inline)
- GSAP animation implementation details (easing, stagger, library choice)
- Profile modal trigger placement and icon
- Per-request language override UX
- Loading state before streaming begins
- Error state for failed generation
- Prompt template variable substitution strategy
- OpenRouter Regular-tier model selection
- Content hash computation strategy

## Deferred Ideas

- Text selection → "Explain" (EXP-03) — Phase 4
- Text selection → "Highlight" (READ-07) — Phase 4
- Passage-level Explainers — Phase 4
