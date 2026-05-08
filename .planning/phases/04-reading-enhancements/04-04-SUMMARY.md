# Plan 04-04 Summary: Explainer History & Passage Integration

**Commit:** `114da3e`
**Date:** 2026-05-07
**Plan:** 04-04 (Explainer History & Passage Integration)

---

## Tasks Executed

### 04-04-a: Extend ExplainerPanel with Tabs, History, and passage support

**File modified:** `src/components/explainer/explainer-panel.tsx`

Changes:
- Added imports: `useQuery`, `useQueryClient` from `@tanstack/react-query`; `Tabs`, `TabsContent`, `TabsList`, `TabsTrigger` from `@/components/ui/tabs`; `Badge` from `@/components/ui/badge`
- Extended `ExplainerPanelProps` interface:
  - `type: "book" | "section" | "passage"` (added `"passage"`)
  - `passageText?: string`
  - `passageCfi?: string`
  - `onNavigateToCfi?: (cfi: string) => void`
- Added `activeTab` state (`"current"` | `"history"`)
- Added history query via `useQuery` fetching `GET /api/explainers/history?bookId=...`
- Updated title logic: `"Passage Explainer"` for `type === "passage"`
- Updated cache check: POST `/api/explainers` with `{ bookId, type, language, passageText }` when `type === "passage"` (avoids URL length limits); GET query string for book/section
- Updated POST body for generation to include `passageText`
- After `setState("complete")`, invalidate history query: `queryClient.invalidateQueries({ queryKey: ["explainer-history", bookId] })`
- Wrapped panel content in `<Tabs>` with:
  - `<TabsList className="w-full grid grid-cols-2">` with Current/History triggers
  - `<TabsContent value="current">` — existing streaming/loading/error/empty states
  - `<TabsContent value="history">` — history list with type badge, tier badge, language, relative time, and "Go to context" button
- Added `formatRelativeTime()` helper

### 04-04-b: Verify ToC panel ExplainerPanel usage for new props

**File verified:** `src/components/reader/toc-panel.tsx`

- No code changes required
- `ExplainerPanel` in `TocEntry` already passes `type="section"` explicitly, which is compatible with the updated `"book" | "section" | "passage"` union type
- All new props (`passageText`, `passageCfi`, `onNavigateToCfi`) are optional — no impact on existing usage

---

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass (no errors) |
| `grep -n "Tabs" explainer-panel.tsx` | 11 matches |
| `grep -n "history" explainer-panel.tsx` | 13 matches |
| `grep -n "passageText" explainer-panel.tsx` | 6 matches |
| `grep -n 'type="section"' toc-panel.tsx` | Match at line 73 |

---

## Requirements Covered

- **EXP-03** (passage-level explainer UI): `type`, `passageText`, `passageCfi`, `onNavigateToCfi` props added; POST cache check for passages
- **EXP-08** (explainer history list): History tab fetches `/api/explainers/history`, displays entries with badges, relative time, and "Go to context" link; invalidates after generation

---

## Notes

- The `/api/explainers/history` endpoint must exist (EXP-08). It was not created in this plan — assuming it's part of the Phase 3 API scope or a prerequisite.
- The `GET /api/explainers/history` route should return `{ explainers: [...] }` where each entry has `id`, `contentType`, `tier`, `language`, `createdAt`, `targetLabel`, `passageCfi`, `sectionHref`.
