# Phase 6: Polish & Scale - Research

**Phase:** 06-polish-scale
**Date:** 2026-05-07

<research_summary>
## Summary

Phase 6 is a tight polish pass with three net-new deliverables: reading progress indicators on book cards (POL-02), Pro/Admin role badges in the UI (POL-05), and bookshelf visual refinements. POL-01 (covers) and POL-03 (tier config) are already complete; POL-04 (cost tracking) is explicitly deferred.

Key findings:
1. **Progress computation** requires joining `UserBookPosition` (existing) with a total paragraph count per book. The `EpubFile` model currently lacks `totalParagraphs`. The cleanest path is adding this field (computed from the stored TXT at upload time) via a small Prisma migration, then calculating `% = paragraphIndex / totalParagraphs` server-side in `getPersonalLibrary()`.
2. **Progress bar UI** should be a thin bar (h-1 or h-1.5) anchored to the bottom of the cover image, using `bg-primary` with `transition-all duration-300` — consistent with the existing `ReadingProgress` component in the reader. A percentage label should appear as small text below the author line, not inside the bar, to stay readable at 200px card width.
3. **Pro badge placement** is most naturally in the `LibraryLayout` header bar, between the nav links and the `UserNav` avatar. The existing `RoleBadge` pattern from `profile/page.tsx` can be extracted and reused. Reader chrome is too crowded for a badge.
4. **Bookshelf polish** should focus on hover micro-interactions (scale + shadow transitions), typographic refinement (reduce title size from 20px to base/sm for card scale), and consistent spacing. No new dependencies needed.
5. All new work must align with established patterns: server-component auth via `requireAuth()`, service-layer Prisma queries, shadcn/ui + Tailwind with `cn()`, slate color tokens, and `lucide-react` icons.
</research_summary>

<findings>

## Finding 1: Progress Computation Approach

### Schema Gap
The `EpubFile` model (`src/server/db/schema.prisma`) stores `txtPath` but has **no `totalParagraphs` field**. `UserBookPosition` has `paragraphIndex` (Int) per user/book. To compute a percentage, we need:

```
% = paragraphIndex / totalParagraphs * 100
```

### Options Evaluated

| Approach | Pros | Cons |
|----------|------|------|
| **A. Add `totalParagraphs Int?` to `EpubFile`, compute at upload** | One-time cost; trivial query-time math; future-proof | Requires Prisma migration |
| **B. Read TXT file at query time, count `\n\n` splits** | No schema change | O(N) file I/O per library load; messy |
| **C. Build paragraph map client-side from EPUB** | No schema change | Requires loading EPUB in browser; not feasible for card grid |

**Recommendation:** Option A. The `extractText` function in `src/server/services/epub-processor.ts` already joins section texts with `\n\n`. After parsing, `parsed.text.split('\n\n').length` gives the total paragraph count. Store it during `processAndUploadBook`. Run a small migration.

For existing books without `totalParagraphs`, the progress bar simply does not render (graceful degradation — aligns with "books never opened show no progress bar").

### Query Pattern
`getPersonalLibrary()` in `src/server/services/library.ts` currently returns:

```ts
return db.userBookAccess.findMany({
  where: { userId },
  include: { book: true },
  orderBy: { createdAt: "desc" },
});
```

Extend it to also fetch the user's positions in a parallel query (no schema relation exists between `UserBookAccess` and `UserBookPosition`):

```ts
const [accesses, positions] = await Promise.all([
  db.userBookAccess.findMany({ where: { userId }, include: { book: true } }),
  db.userBookPosition.findMany({ where: { userId } }),
]);
```

Map positions by `bookId`, compute `%` where both `paragraphIndex` and `book.totalParagraphs` exist, and return a shaped object:

```ts
interface LibraryBook {
  id: string;
  title: string;
  author: string | null;
  language: string;
  coverPath: string | null;
  progress: number | null; // null = never opened or missing totalParagraphs
}
```

### Type Propagation
- `src/types/book.ts` — extend `BookWithAccess` or create a new `LibraryBook` type with `progress?: number`.
- `src/components/library/bookshelf.tsx` — update `Book` interface to include optional `progress`.
- `src/components/library/book-card.tsx` — add `progress?: number` prop.

## Finding 2: Progress Bar UI Patterns

### Existing Pattern in Codebase
The reader already has a progress bar (`src/components/reader/reading-progress.tsx`):

```tsx
<div className="absolute bottom-0 left-0 right-0 z-50 h-1 bg-muted" ...>
  <div className="h-full bg-primary transition-all duration-300" style={{ width: `${percentage}%` }} />
</div>
```

This establishes the design language: thin (h-1), `bg-muted` track, `bg-primary` fill, 300ms transition.

### Card-Scale Adaptation
The `BookCard` cover container is:

```tsx
<div className="relative aspect-[3/4] w-full bg-slate-100">
```

The progress bar should be anchored **inside** this relative container at the bottom:

```tsx
{progress !== undefined && progress > 0 && (
  <>
    {/* Bar */}
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/10">
      <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
    </div>
    {/* Percentage label */}
    <div className="absolute bottom-1.5 right-1.5 text-[10px] font-medium text-white drop-shadow-sm">
      {Math.round(progress)}%
    </div>
  </>
)}
```

**Design rationale:**
- `h-1` (4px) matches the reader's `ReadingProgress` for consistency.
- `bg-black/10` track provides contrast against both light and dark cover images (vs `bg-muted` which may clash).
- Percentage text overlaid at the bottom-right uses a subtle text shadow / `drop-shadow` for legibility on any cover. `text-[10px]` is readable at 200px card width.
- Only render when `progress > 0` — aligns with D-02 ("books never opened show no progress bar").

**Alternative:** If overlay text feels intrusive, move the percentage below the author line as `text-xs text-muted-foreground text-right`. The decision D-01 explicitly says "showing % read (e.g. '47%')" — either location satisfies this. The overlay is more Kindle-like.

## Finding 3: Pro Badge Placement

### Existing Badge Infrastructure
- `src/components/ui/badge.tsx` — shadcn Badge with variants (default, secondary, outline, ghost, destructive, link).
- `src/app/profile/page.tsx` — `RoleBadge` component differentiates `admin` (outline + Shield icon), `pro` (`bg-slate-900 text-white`), `regular` (secondary).
- `src/components/auth/user-nav.tsx` — Header user dropdown; already reads `(user as any).role`.
- `src/app/(library)/layout.tsx` — Library layout header: logo left, nav center, `UserNav` right.

### Placement Options

| Location | Pros | Cons |
|----------|------|------|
| **Library header, next to `UserNav`** | Always visible on main surface; natural status indicator | Takes header space |
| **Inside `UserNav` dropdown** | Zero header space used | Hidden behind click; low visibility |
| **Reader chrome header** | Visible while reading | Already crowded with ToC, search, TTS, theme, bookmarks |
| **Book detail page, near title** | Contextual | Only visible on one page |

**Recommendation:** Primary placement in `LibraryLayout` header, between the nav links and `UserNav`. Secondary placement on book detail page (`src/app/(library)/book/[id]/page.tsx`) near the metadata row.

**Header integration:**
```tsx
<header className="flex h-16 items-center border-b border-slate-200 bg-white px-8">
  <Link href="/my-library" className="text-[20px] font-semibold text-slate-900">
    BusyReader
  </Link>
  <nav className="mx-auto flex items-center gap-6">
    <Link href="/my-library" ...>My Library</Link>
  </nav>
  <div className="flex items-center gap-3">
    <RoleBadge role={user.role} />
    <UserNav />
  </div>
</header>
```

Note: `LibraryLayout` is currently a server component (no "use client"). To access `user.role`, either:
1. Convert `LibraryLayout` to an `async` server component that calls `requireAuth()` (simplest), or
2. Create a small `HeaderBadges` client component that reads from `useSession()`.

Option 1 is preferred because `requireAuth()` is already the established pattern for server components (`src/app/(library)/my-library/page.tsx`, `src/app/profile/page.tsx`, etc.).

**RoleBadge reuse:** Extract `RoleBadge` from `profile/page.tsx` into `src/components/auth/role-badge.tsx` so both profile and header can import it. It has no async dependencies — it's a pure presentational component.

### Badge Visibility Rules (per D-04)
- `pro` → show "Pro" badge
- `admin` → show "Admin" badge
- `regular` → show nothing (no badge)

## Finding 4: Bookshelf Visual Polish

### Current State
`Bookshelf` (`src/components/library/bookshelf.tsx`):
- Grid: `grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-6`
- Skeleton: identical grid with `Skeleton` placeholders

`BookCard` (`src/components/library/book-card.tsx`):
- Cover: `relative aspect-[3/4] w-full bg-slate-100`, `rounded-md` overflow
- Title: `text-[20px] font-semibold leading-tight text-slate-900 line-clamp-2`
- Author: `text-sm text-muted-foreground truncate`
- Placeholder: deterministic color from title hash + `BookOpen` icon
- Language badge: absolute top-right on cover
- No hover effects, no transitions, no shadow

### Issues at Card Scale
- `text-[20px]` title on a 200px-wide card produces ~3-4 words per line. With `line-clamp-2`, titles longer than ~8 words are truncated. This feels oversized and unbalanced.
- No visual feedback on hover makes the grid feel static.
- Placeholder covers use flat colors without texture — acceptable but could be elevated with a subtle gradient or pattern.

### Recommended Polish (no new deps)
1. **Title sizing:** Reduce to `text-base` (16px) or `text-sm` (14px) with `font-semibold`. At 200px width, `text-base` yields ~5-6 words per line — much better balance.
2. **Hover micro-interactions:**
   - Card container: `transition-shadow duration-200 hover:shadow-md`
   - Cover image: `transition-transform duration-300 group-hover:scale-105` (inside `overflow-hidden rounded-md`)
   - This creates a gentle "lift" effect without layout shift.
3. **Spacing refinement:**
   - Change grid gap to `gap-x-6 gap-y-8` for more vertical breathing room.
   - Add `px-1` to the text area so text doesn't hug the card edge.
4. **Placeholder enhancement:**
   - Add a subtle linear gradient overlay `bg-gradient-to-br from-white/10 to-black/10` on placeholder covers for depth.
   - Or keep it simple — the hash-based colors are already functional.
5. **Empty state:** `EmptyLibrary` (`src/components/library/empty-library.tsx`) is clean but could use a larger icon (`h-16 w-16`) and slightly more generous vertical spacing (`min-h-[50vh]` instead of `60vh` feels less desolate).

### CSS Techniques Summary
All achievable with Tailwind utilities already in use:
- `transition-transform`, `transition-shadow`, `duration-200/300`
- `group-hover:scale-105`, `group-hover:shadow-md`
- `overflow-hidden` on the rounded container to clip the scaled image
- `drop-shadow-sm` for text overlays on covers

## Finding 5: Existing Codebase Patterns

### Auth & Data Flow
- Server pages call `requireAuth()` → get `user` object → pass `user.id` to service functions.
- Service functions live in `src/server/services/` and use the Prisma client singleton from `src/server/db/index.ts`.
- No client-side data fetching for library pages; all data is fetched in server components and passed as props.

### Component Conventions
- Presentational components in `src/components/library/`, `src/components/reader/`, etc.
- shadcn/ui components in `src/components/ui/` — imported via `@/components/ui/*`.
- Utility merging via `cn()` in `src/lib/utils.ts`.
- Icons from `lucide-react`.

### Styling Tokens
- Colors: slate palette with semantic CSS variables (`--primary`, `--muted`, `--border`, etc.).
- Tailwind v4 with `@theme inline` in `src/app/globals.css`.
- Radius: `--radius: 0.625rem` (10px). `rounded-md` is used throughout.

### Type Safety
- `src/types/book.ts` exports `Book`, `BookWithAccess`, `UserRole`.
- Component props are typically inline interfaces (e.g., `BookCardProps`).

### Testing
- Vitest for unit tests (`vitest.config.ts` with `environment: "node"`).
- Playwright for E2E (`playwright.config.ts` with chromium).
- Existing test patterns in `src/server/services/__tests__/`, `src/app/api/**/__tests__/`.

### Relevant Files for Implementation
| File | Relevance |
|------|-----------|
| `src/server/db/schema.prisma` | Add `totalParagraphs Int?` to `EpubFile` |
| `src/server/services/epub-processor.ts` | Compute `totalParagraphs` in `processAndUploadBook` |
| `src/server/services/library.ts` | Join positions, compute `%`, return `progress` |
| `src/components/library/book-card.tsx` | Add progress bar + hover effects |
| `src/components/library/bookshelf.tsx` | Grid refinements (gap, spacing) |
| `src/app/(library)/my-library/page.tsx` | Pass `progress` to `Bookshelf` |
| `src/app/(library)/layout.tsx` | Add `RoleBadge` to header |
| `src/app/(library)/book/[id]/page.tsx` | Optional: add `RoleBadge` near metadata |
| `src/app/profile/page.tsx` | Extract `RoleBadge` to shared component |
| `src/components/auth/user-nav.tsx` | Reference for role access pattern |

</findings>

<validation_architecture>
## Validation Architecture

### POL-02: Progress Indicators
1. **Unit test** `getPersonalLibrary()` in `src/server/services/__tests__/library.test.ts` (create if missing):
   - Mock `UserBookPosition` with `paragraphIndex = 50` and `EpubFile.totalParagraphs = 100` → expect `progress = 50`.
   - Mock no position → expect `progress = null`.
   - Mock position but `totalParagraphs = null` → expect `progress = null`.
2. **Visual verification** (manual or Playwright screenshot):
   - Card with `progress > 0` shows thin bar at bottom of cover.
   - Card with `progress = null` shows no bar.
   - Bar width matches percentage.
3. **Integration test** (Playwright):
   - Open a book, scroll to a known position, return to library → progress bar reflects the saved position.

### POL-05: Pro Badges
1. **Unit test** `RoleBadge` component:
   - `role="pro"` renders "Pro" with correct classes.
   - `role="admin"` renders "Admin" with Shield icon.
   - `role="regular"` returns `null` (no badge).
2. **Integration test** (Playwright):
   - Log in as pro user → badge visible in library header.
   - Log in as regular user → no badge.
   - Log in as admin user → "Admin" badge visible.

### Bookshelf Visual Polish
1. **Visual regression** (Playwright screenshot comparison or manual review):
   - Hover over card → cover scales slightly, shadow appears.
   - Grid spacing looks balanced at multiple viewport widths.
   - Title font size is proportionate to card width.
2. **Accessibility check**:
   - Progress bar has `role="progressbar"`, `aria-valuenow`, `aria-label` (mirror `ReadingProgress`).
   - Color contrast on percentage label meets WCAG (white text with `drop-shadow` on covers).

### Build & Type Safety
- `pnpm build` passes with no TypeScript errors.
- `pnpm test` passes (existing tests + any new tests).
- `pnpm lint` passes (if configured).

</validation_architecture>
