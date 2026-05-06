# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 1-Foundation
**Areas discussed:** Library browsing experience, Upload flow & feedback, Admin panel structure, Role visibility & feature gating

---

## Library browsing experience

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Grid layout | Card-based grid with cover images, title, author, language badge | ✓ |
| List layout | Information-dense list view | (deferred) |
| Extract covers from EPUB | Use cover image embedded in EPUB file | ✓ |
| Generic placeholders | Fallback when no cover found | ✓ |

**User's choice:** "I will be refining these in a later version. For now, I trust you to use your best judgement here."
**Notes:** Agent selected grid layout as default (Apple Books/Kindle pattern), cover extraction with generic fallback, and deferred list toggle. User confirmed trust in agent judgement.

---

## Upload flow & feedback

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Drag-and-drop zone | Primary upload mechanism with file picker fallback | ✓ |
| File picker only | Simple button, no drag-and-drop | |
| Multi-step progress | Show hashing → checking → converting → done | ✓ |
| Simple spinner | Generic "Uploading..." without steps | |
| Redirect to book detail | Land on the newly uploaded book's page | ✓ |
| Redirect to My Library | Return to library list | |

**User's choice:** "I will be refining these in a later version. For now, I trust you to use your best judgement here."
**Notes:** Agent selected drag-and-drop with multi-step progress indicator, redirect to book detail on success, and toast notification on MD5 match.

---

## Admin panel structure

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Dedicated /admin layout | Sidebar navigation with sections | ✓ |
| Tabbed single page | All admin functions in one view | |
| Server-side role validation | Check role on every request | ✓ |
| Client-side guards only | Rely on UI hiding | |

**User's choice:** "I will be refining these in a later version. For now, I trust you to use your best judgement here."
**Notes:** Agent selected dedicated admin layout with sidebar, server-side validation on every request, and audit log stored in database.

---

## Role visibility & feature gating

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Hide admin routes | No nav items, no disabled links for non-admins | ✓ |
| Show but disabled | Admin link visible but greyed out | |
| Visible but locked | Pro features shown to Regular users with lock icon | ✓ (for future phases) |
| Completely hidden | Pro features invisible to Regular users | |

**User's choice:** "I will be refining these in a later version. For now, I trust you to use your best judgement here."
**Notes:** Agent selected hide-admin-routes for Phase 1, and visible-but-locked pattern for future Pro features. Phase 1 has no Pro-gated features.

---

## the agent's Discretion

- Exact spacing, typography, and color palette for library grid cards
- Loading skeleton design for library and book detail pages
- Toast notification styling and duration
- Exact sidebar navigation item ordering and icons
- Admin table pagination and sorting defaults
- Upload dropzone visual design

## Deferred Ideas

- List view toggle for My Library
- Detailed visual design refinement
- Native mobile app (v2)
- Self-serve billing (v2)
- PDF/DOCX/MOBI support (v2)
