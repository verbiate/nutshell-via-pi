# Phase 6: Polish & Scale - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 06-polish-scale
**Areas discussed:** Phase scope assessment, reading progress, Pro badges, bookshelf polish, cost tracking

---

## Scope Assessment: What's Already Done

| Option | Description | Selected |
| --- | --- | --- |
| POL-01 (Cover extraction) | Already implemented in epub-processor | ✅ No work needed |
| POL-03 (Tiered AI config) | Already implemented in admin config page | ✅ No work needed |
| POL-04 (Cost tracking) | Greenfield — no infrastructure exists | Skipped by user |
| POL-02 (Progress indicators) | No progress shown on book cards | ✅ Needs implementation |
| POL-05 (Pro badges) | Partial — RoleBadge on profile only | ✅ Needs implementation |

**User's choice:** Identified that 2 of 5 requirements are already complete. Cost tracking explicitly deferred. Real work is progress indicators + Pro badges + bookshelf polish.

---

## Reading Progress (POL-02)

| Option | Description | Selected |
| --- | --- | --- |
| % progress bar | Thin bar along bottom of book card showing % read, Kindle-style | ✓ |
| Agent's discretion | Agent picks visual treatment | |

**User's choice:** % progress bar — "clean, minimal, like Kindle"

---

## Pro Badges (POL-05)

| Option | Description | Selected |
| --- | --- | --- |
| Specific placement | User picks exact locations | |
| Agent's discretion | Agent decides based on actual layout | ✓ |

**User's choice:** Agent's discretion. User envisioned top-of-page bar but hasn't seen the actual layout. Trusts agent's judgement on placement.

---

## Bookshelf Polish

| Option | Description | Selected |
| --- | --- | --- |
| Agent's discretion | Agent uses frontend design skills to elevate the bookshelf | ✓ |

**User's choice:** Agent's discretion. Noted that several frontend design skills are available (ui-design-toolkit, visual-design, frontend-design).

---

## Cost Tracking (POL-04)

**User's choice:** Explicitly skipped. "Intended to be a beautiful proof of concept, so we do not need this yet."

---

## Agent's Discretion

- Progress bar exact design (height, color, animation, corner radius)
- Pro badge placement across UI (header, reader, explainer panel, book detail, book cards)
- Badge visual design (icon, color, size, animation)
- Bookshelf layout refinements (card spacing, hover effects, transitions, empty state polish)
- Micro-interactions (card hover zoom, cover shine effect, etc.)
- Whether progress computation happens server-side or client-side
- How to handle "never opened" state (no bar vs "0%" vs "New" label)

## Deferred Ideas

- **POL-04: Cost tracking dashboard** — deferred by user, no version tag
- **Library-level search** — deferred from Phase 4, still deferred
