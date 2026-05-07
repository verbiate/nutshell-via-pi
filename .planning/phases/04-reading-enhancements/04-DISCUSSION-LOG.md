# Phase 4: Reading Enhancements - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 4-reading-enhancements
**Areas discussed:** Bookmarks & highlights data model, Text selection UX, Search implementation, Explainer history

---

## Bookmarks & highlights data model

| Option | Description | Selected |
|--------|-------------|----------|
| A: CFI-only | Store only CFI for bookmarks/highlights | |
| B: Paragraph + offset only | Store paragraph index + char offset | |
| C: Hybrid (CFI + paragraph + text) | Store CFI, paragraph index, AND literal selected text as checksum/recovery | ✓ |

**User's choice:** "I'm happy to take your recommendation here (C)"
**Notes:** User deferred to agent recommendation. Hybrid chosen for resilience: CFI provides precise addressing, paragraph index aligns with existing position system, literal text provides drift detection/recovery.

---

## Text selection UX

| Option | Description | Selected |
|--------|-------------|----------|
| A: Floating toolbar above selection | Like Medium/Kindle; appears near selected text | ✓ |
| B: Context menu (right-click / long-press) | Native-feeling but less discoverable | |
| C: Persistent toolbar button | Button in reader chrome activates on selection | |

**User's choice:** "I was thinking a floating toolbar is the most common, but that it might be cleaner to have it appear as a toolbar in a disappearing/reappearing header or footer... I trust you to use your best judgement here, as we can always change this later."
**Notes:** User prefers floating toolbar as primary but accepts header/footer fallback if iframe positioning proves difficult. epub-ts `rendition.on("selected")` event is the intended trigger mechanism.

---

## Search implementation

| Option | Description | Selected |
|--------|-------------|----------|
| A: Server-side search via API | `GET /api/books/[id]/search?q=...` with debouncing | |
| B: Client-side search (fetch TXT, search in memory) | Download TXT once, search locally with regex/string scan | ✓ |

**User's choice:** "I actually lean toward B given the speed benefits. Feel free to push back if you think I have it wrong. For library-level search, which I don't believe we have in v1, we can do something closer to option A."
**Notes:** User accepted memory tradeoff for instant results. Agent confirmed this is viable since TXT files are already stored from Phase 1 upload pipeline. Server-side search reserved for future library-level scope. Mapping results to CFI uses existing Phase 2 paragraph↔CFI library.

---

## Explainer history (EXP-08)

| Option | Description | Selected |
|--------|-------------|----------|
| A: Integrated into existing Explainer panel | Tab switcher: Current / History inside right-side panel | ✓ |
| B: Separate dedicated panel | New icon in chrome opens standalone history panel | |
| C: Book detail page section | Collapsible section on `/book/[id]` | |

**User's choice:** "Option A actually feels pretty natural, as it can function as a sort of pivotable list/detail view. Users would see the 'details' of the currently generating Explainer, and if they go 'back' to the list, they could see this entry (with a loading indicator, as appropriate) alongside the history of other Explainers. Each would have an indication of what was being Explained, along with a one-click link back to view it in context."
**Notes:** User described the list/detail pivot in detail. History entries include: type (book/section/passage), target label, language, date, tier. Generating explainers show loading indicator in the list. One-click navigation back to context is required.

---

## the agent's Discretion

- Floating toolbar exact positioning algorithm (iframe coordinates vs. chrome fallback)
- Highlight color palette (single default vs. multi-color)
- Bookmark/highlight panel grouping (shared vs. separate panels)
- Client-side search indexing strategy (naive scan vs. pre-built index)
- TXT fetch strategy (full download vs. chunked)
- History list sorting and empty state
- Passage explainer history entry preview length
- Current/History view transition animation

## Deferred Ideas

- Library-level search across all books — future phase
- Multi-color highlights — v2
- Bookmark/highlight sharing — out of scope
- Offline persistence — requires service worker; v2
