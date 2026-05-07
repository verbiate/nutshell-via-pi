# Phase 2: Core Reading Experience - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 02-core-reading
**Areas discussed:** Rendering approach, Reader layout & navigation, Theme & typography, Position persistence

---

## Rendering Approach

| Option | Description | Selected |
| --- | --- | --- |
| EPUB-native rendering | Render directly from EPUB for rich formatting, images, proper chapter structure | ✓ |
| TXT-based rendering | Render from the already-extracted TXT (simpler, no formatting) | |
| Hybrid (EPUB display + TXT for AI) | EPUB for reader, TXT for AI pipeline | ✓ (implicit) |

**User's choice:** EPUB-native rendering — emphatic ("OBVIOUSLY we want to render directly from the EPUB")
**Notes:** User was very clear this is the only acceptable approach. TXT is strictly for the AI pipeline.

---

## Reader Layout & Navigation

| Option | Description | Selected |
| --- | --- | --- |
| Full-screen immersive + slide-out ToC | Book content fills viewport, ToC accessed via slide-out panel | ✓ |
| Split view with persistent sidebar | ToC always visible alongside content | |
| Minimal overlay reader | Reader as overlay on book detail page | |

**User's choice:** Full-screen immersive with slide-out ToC
**Notes:** User confirmed "sounds great" for this approach. Dedicated reader route at `/book/[id]/reader`.

---

## Theme & Typography

| Option | Description | Selected |
| --- | --- | --- |
| Minimal (themes only for v1) | Light/dark/sepia themes, defer font controls to future | ✓ |
| Full Kindle-like controls | Font size, family, spacing, margins all in v1 | |
| Moderate (themes + font size) | Three themes plus font size adjustment | |

**User's choice:** Minimal — three themes only for v1
**Notes:** User explicitly wants font size, family, spacing, margins "in a future version, but we can keep it simple for now."

---

## Position Persistence

| Option | Description | Selected |
| --- | --- | --- |
| Agent's discretion | User trusts judgement for v1 approach | ✓ |

**User's choice:** Agent's discretion
**Notes:** User said "I trust you to use your best judgement for a v1 here." Content-based positioning (paragraph index + char offset) is required by READ-05.

---

## Reader Route

| Option | Description | Selected |
| --- | --- | --- |
| Dedicated route (/book/[id]/reader) | Full page transition, immersive feel | ✓ |
| Overlay on book detail page | Reader takes over screen within same route | |

**User's choice:** Agent's discretion (user confirmed "I trust you to use your best judgement")
**Notes:** Dedicated route chosen as it aligns with full-screen immersive preference.

---

## the agent's Discretion

- Autosave frequency and debounce timing for position persistence
- Loading state design while EPUB renders
- Back navigation from reader to book detail
- Scroll behavior (continuous vs paginated)
- Error state for failed EPUB rendering
- Mobile responsiveness details
- Reader chrome design (toolbar, theme toggle placement)

## Deferred Ideas

- Font size, font family, line spacing, margin controls — future version
- Bookmarks (READ-06) — Phase 4
- Highlights (READ-07) — Phase 4
- In-book search (READ-08) — Phase 4
- Passage-level Explainers (EXP-03) — Phase 4
