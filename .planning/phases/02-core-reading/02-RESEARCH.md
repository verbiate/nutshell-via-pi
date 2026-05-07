# Phase 2: Core Reading Experience - Research

**Researched:** 2026-05-07
**Domain:** Browser-based EPUB rendering, content-based position tracking, Next.js immersive layouts
**Confidence:** HIGH

## Summary

Phase 2 delivers a full-screen EPUB reader with three themes (light/dark/sepia), hierarchical ToC navigation via slide-out panel, and content-based reading position persistence. The core technical decisions are:

1. **Build a custom React wrapper around `@likecoin/epub-ts`** (~200 LOC) rather than installing `react-reader`. This avoids the unmaintained `epubjs` dependency, gives full control over the iframe renderer, and integrates cleanly with shadcn/ui and our theme system.

2. **Position tracking uses a bidirectional mapping layer** between `epubjs` CFI (runtime) and paragraph index + char offset (persistence). CFI survives reflow naturally; the mapping layer converts to/from the required storage format on save/restore.

3. **Theme sync requires dual propagation:** `next-themes` manages the app chrome (class on `<html>`), while `rendition.themes.register/select()` injects CSS into the EPUB iframe. Sepia is a custom third theme added to both systems.

4. **Reader lives in its own route group** `(reader)` with no persistent header, achieving the full-screen immersive requirement. The existing `(library)` header would violate D-03.

5. **Database needs a new `UserBookPosition` model** to store paragraph index + char offset per user per book.

## User Constraints (from CONTEXT.md)

- Render directly from EPUB file (NOT TXT) — D-01
- Full-screen immersive reader, no persistent sidebar — D-03
- ToC via slide-out panel using shadcn Sheet — D-04
- Reader route at `/book/[id]/reader` — D-05
- Three themes: light, dark, sepia — D-07
- Minimal typography controls for v1 (theme only) — D-08
- Content-based position: paragraph index + char offset — D-10, D-11
- Must survive theme and font-size changes — D-11
- Success criterion #5: "as polished as Apple Books or Kindle"

## Standard Stack

| Technology | Version | Role in Phase 2 | Notes |
|---|---|---|---|
| Next.js | 16.2.5 | App Router, route groups | `(reader)` group for full-screen layout |
| React | 19.2.6 | Component model | Custom wrapper component around epub-ts |
| TypeScript | 6.0.3 | Type safety | Strict mode required |
| Tailwind CSS | 4.2.4 | Styling | CSS variables for themes; `@custom-variant dark` already in globals.css |
| shadcn/ui | 4.7.0 | Sheet, ScrollArea, Button, Tooltip | All already installed |
| `@likecoin/epub-ts` | 0.6.3 | EPUB parsing + browser rendering | **Already installed.** Drop-in epubjs replacement. Exports `Book`, `Rendition`, `Themes`, `EpubCFI`, `Locations` |
| `next-themes` | 0.4.6 | Theme management | **Already installed but NOT wired up.** Needs `ThemeProvider` in `Providers.tsx` |
| Prisma | 5.22.0 | ORM | Needs schema addition for `UserBookPosition` |
| SQLite | 3.x | Database | Zero-config, sufficient for v1 |
| Zustand | 5.0.13 | Client state | Reader UI state (sidebar open, current section) |

### What needs installation

| Package | Version | Why |
|---|---|---|
| None | — | All dependencies for Phase 2 are already installed. No new packages required. |

### What should NOT be installed

| Package | Why Avoid | Alternative |
|---|---|---|
| `react-reader` | Depends on unmaintained `epubjs` ^0.3.93 (published >1 year ago). Class-based React component, hard to theme. Bundles its own ToC UI that conflicts with shadcn Sheet requirement. | Custom ~200 LOC wrapper around `@likecoin/epub-ts` |
| `epubjs` | Unmaintained, 56% larger bundle, 99% slower `locations.generate()`, no TypeScript strict mode | `@likecoin/epub-ts` (already installed) |

## Architecture Patterns

### Pattern 1: Custom React Wrapper for EPUB Rendering

`@likecoin/epub-ts` provides a `Book` class with `renderTo(element, options)` that returns a `Rendition`. The Rendition injects an iframe and manages pagination/scroll. A React wrapper encapsulates lifecycle:

```typescript
// hooks/use-epub-rendition.ts (conceptual)
function useEpubRendition(url: string, containerRef: RefObject<HTMLDivElement>) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [toc, setToc] = useState<NavItem[]>([]);
  const bookRef = useRef<ePub.Book | null>(null);
  const renditionRef = useRef<ePub.Rendition | null>(null);

  useEffect(() => {
    const book = ePub(url);
    bookRef.current = book;

    book.ready.then(() => {
      setToc(book.navigation.toc);
      if (!containerRef.current) return;
      const rendition = book.renderTo(containerRef.current, {
        width: '100%',
        height: '100%',
        flow: 'paginated', // or 'scrolled-doc' for continuous scroll
        manager: 'default',
      });
      renditionRef.current = rendition;
      rendition.display();
      setIsLoaded(true);
    });

    return () => { book.destroy(); };
  }, [url]);

  return { isLoaded, toc, bookRef, renditionRef };
}
```

**Key Rendition events:**
- `relocated` (Location): Fired when user turns page/scrolls. Contains `start.cfi`, `end.cfi`, `percentage`.
- `displayed` (Section): Fired when a section first renders.
- `rendered` (Section, IframeView): Fired after iframe content is injected.
- `selected` (cfiRange, Contents): Fired on text selection (used in Phase 4).

**Navigation API:**
- `rendition.display(cfi: string)` — jump to specific CFI
- `rendition.display(href: string)` — jump to spine item href
- `rendition.next()` / `rendition.prev()` — paginated navigation
- `rendition.on('relocated', callback)` — position tracking

### Pattern 2: Bidirectional Position Mapping (CFI <-> Paragraph Index + Char Offset)

`epubjs` natively uses CFI (e.g., `epubcfi(/6/4[id4]!/4/2/8/1:100)`). The requirement mandates paragraph index + char offset for persistence.

**Runtime → Storage (on save):**
1. `relocated` event provides `location.start.cfi`
2. Use `book.spine.get(cfi)` to find the current `Section`
3. Use `EpubCFI.parse(cfi)` + `EpubCFI.findNode()` to locate the DOM element and offset inside the iframe
4. Count all `<p>` elements in preceding spine items (cached in a `paragraphMap`)
5. Count `<p>` elements within current section up to the target element
6. `paragraphIndex = precedingCount + currentCount`
7. `charOffset = offset within the target paragraph's textContent`
8. Debounce POST to `/api/reader/position`

**Storage → Runtime (on restore):**
1. GET saved position `{ paragraphIndex, charOffset }`
2. If `paragraphMap` not built, build it by iterating `book.spine` and counting `<p>` elements per section
3. Find the spine item containing `paragraphIndex`
4. Load the section HTML, find the Nth `<p>`
5. Construct a CFI for that paragraph at `charOffset` using `EpubCFI.generateChapterComponent()` + path
6. `rendition.display(cfi)`

**Paragraph map caching:**
- Build once per book open, store in Zustand or React state
- Structure: `Array<{ spineIndex: number; sectionHref: string; paragraphCount: number; paragraphCfis: string[] }>`
- For v1, build lazily as user navigates; pre-computing all sections on open may be slow for large books

**Alternative for v1 (simpler):**
Store both `cfi` (for instant resume) and `paragraphIndex + charOffset` (for requirement compliance). On restore, prefer CFI for accuracy; if CFI fails (rare), fall back to paragraph mapping. This gives instant resume while still satisfying the storage requirement.

### Pattern 3: Dual Theme System (App + Iframe)

`next-themes` controls the app shell; `rendition.themes` controls the book content inside the iframe.

```typescript
// Sync app theme to iframe theme
useEffect(() => {
  if (!rendition) return;
  rendition.themes.register('light', {
    body: { color: '#1a1a1a', background: '#ffffff' },
    '::selection': { background: '#b3d9ff' },
  });
  rendition.themes.register('dark', {
    body: { color: '#e8e8e8', background: '#1a1a1a' },
    '::selection': { background: '#2a4d6e' },
  });
  rendition.themes.register('sepia', {
    body: { color: '#5b4636', background: '#f4ecd8' },
    '::selection': { background: '#d4c5a9' },
  });
  rendition.themes.select(resolvedTheme);
}, [rendition, resolvedTheme]);
```

**Sepia color values (industry standard):**
- Background: `#f4ecd8` (warm parchment)
- Foreground/text: `#5b4636` (dark brown)
- Muted: `#e9dfc6`
- Border: `#d4c5a9`
- Selection: `#d4c5a9`

### Pattern 4: Full-Screen Route Group

The existing `(library)` layout has a persistent header (`h-16`). The reader must be full-screen per D-03.

```
src/app/
├── (library)/
│   ├── layout.tsx          # Has header — NOT for reader
│   └── book/[id]/
│       └── page.tsx        # Detail page with "Open Reader" button
├── (reader)/
│   ├── layout.tsx          # No header, full-screen
│   └── book/[id]/
│       └── reader/
│           └── page.tsx    # Reader page
```

`(reader)/layout.tsx`:
```tsx
export default function ReaderLayout({ children }) {
  return <div className="h-screen w-screen overflow-hidden">{children}</div>;
}
```

The reader page still calls `requireAuth()` for auth-gating.

## Don't Hand-Roll

| What | Use Instead | Why |
|---|---|---|
| EPUB parsing/rendering engine | `@likecoin/epub-ts` (installed) | 970+ tests, 57KB gzipped, actively maintained, drop-in for epubjs |
| ToC slide-out panel | shadcn `Sheet` (installed) | Accessible, animated, RTL-friendly, already in codebase |
| ToC scrollable list | shadcn `ScrollArea` (installed) | Custom scrollbar, touch-friendly |
| Theme management | `next-themes` (installed) | Handles SSR flash, localStorage sync, system preference |
| Theme CSS variables | Tailwind v4 `@theme inline` | Already configured in globals.css |
| EPUB URL → accessible URL | Existing `/api/files/` routes | File serving abstraction already exists |
| Auth gating | `requireAuth()` from `@/lib/auth-guards` | Established pattern from Phase 1 |
| Debounced position save | `useEffect` + `setTimeout` or lodash debounce | Don't build custom debounce for v1 |

## Common Pitfalls

### Pitfall 1: Installing `react-reader` and bundling unmaintained `epubjs`

`react-reader@2.0.15` peer-depends on `epubjs@^0.3.93`. If installed, npm will install `epubjs` alongside `@likecoin/epub-ts`, bloating the bundle with a larger, slower, unmaintained library. `react-reader` is also a class-based component (not hooks), making theme sync and position tracking more complex.

**Fix:** Build a custom wrapper. The core logic is ~200 LOC: create `Book`, call `renderTo`, wire events, expose navigation methods.

### Pitfall 2: Scroll-percentage-based position tracking

Storing `scrollPercent: 0.47` breaks instantly when the user changes theme (different line heights) or font size. The position drifts with every layout change.

**Fix:** Use paragraph index + char offset. Map to/from CFI at runtime. Never store pixel or scroll values.

### Pitfall 3: Forgetting to sync theme into the EPUB iframe

`next-themes` sets a class on `<html>`. The book content renders in an iframe with its own `<html>` and `<body>`. If you only update the outer page, the book stays in its default theme.

**Fix:** Always call `rendition.themes.select(themeName)` when `resolvedTheme` changes. Register light/dark/sepia CSS rules on `rendition` initialization.

### Pitfall 4: Hydration mismatch with `next-themes`

`useTheme()` returns `undefined` on the server. Rendering theme-dependent UI (e.g., a theme toggle button) during SSR causes hydration errors.

**Fix:** Mount gate: `const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []);` Only render theme UI after `mounted === true`. Or render a generic placeholder (same dimensions) server-side.

### Pitfall 5: Blocking the main thread with paragraph map generation

For a large book (War and Peace, 1.7MB), iterating all spine items and parsing HTML to count paragraphs can take 500ms+.

**Fix:** Build the paragraph map lazily (only for visited sections) or offload to a Web Worker. For v1, lazy building is sufficient.

### Pitfall 6: Memory leak from not destroying the Book instance

`ePub.Book` holds references to JSZip, DOM iframes, and event listeners. Not calling `book.destroy()` on unmount leaks memory.

**Fix:** Always return a cleanup function from the `useEffect` that creates the book:
```typescript
return () => {
  rendition?.destroy();
  book?.destroy();
};
```

### Pitfall 7: Using CFI directly as the persisted format

While CFI survives reflow, the requirement explicitly mandates paragraph index + char offset. Storing only CFI would fail requirement verification.

**Fix:** Store paragraph index + char offset in the database. Use CFI only as a runtime navigation mechanism. The mapping layer bridges the two.

## Code Examples

### Reader component skeleton

```tsx
// src/components/reader/epub-viewer.tsx
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import ePub from '@likecoin/epub-ts';
import type { Rendition, Book, NavItem } from '@likecoin/epub-ts';

interface EpubViewerProps {
  url: string;
  initialPosition?: { paragraphIndex: number; charOffset: number } | null;
  onPositionChange?: (position: { paragraphIndex: number; charOffset: number }) => void;
  onTocLoaded?: (toc: NavItem[]) => void;
  theme: 'light' | 'dark' | 'sepia';
}

export function EpubViewer({ url, initialPosition, onPositionChange, onTocLoaded, theme }: EpubViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const book = ePub(url);
    bookRef.current = book;

    book.ready.then(() => {
      onTocLoaded?.(book.navigation.toc);
      if (!containerRef.current) return;

      const rendition = book.renderTo(containerRef.current, {
        width: '100%',
        height: '100%',
        flow: 'paginated',
      });
      renditionRef.current = rendition;

      // Register themes
      rendition.themes.register('light', {
        body: { color: '#1a1a1a', background: '#ffffff' },
      });
      rendition.themes.register('dark', {
        body: { color: '#e8e8e8', background: '#1a1a1a' },
      });
      rendition.themes.register('sepia', {
        body: { color: '#5b4636', background: '#f4ecd8' },
      });
      rendition.themes.select(theme);

      // Position tracking
      rendition.on('relocated', (location) => {
        const cfi = location.start.cfi;
        const position = cfiToParagraphOffset(book, cfi); // mapping function
        onPositionChange?.(position);
      });

      rendition.display().then(() => {
        setIsLoaded(true);
        if (initialPosition) {
          const cfi = paragraphOffsetToCfi(book, initialPosition);
          rendition.display(cfi);
        }
      });
    });

    return () => {
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
    };
  }, [url]);

  // Theme sync
  useEffect(() => {
    renditionRef.current?.themes.select(theme);
  }, [theme]);

  return (
    <div ref={containerRef} className="h-full w-full">
      {!isLoaded && <ReaderSkeleton />}
    </div>
  );
}
```

### ToC panel with shadcn Sheet

```tsx
// src/components/reader/toc-panel.tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';
import type { NavItem } from '@likecoin/epub-ts';

interface TocPanelProps {
  toc: NavItem[];
  onNavigate: (href: string) => void;
}

function TocEntry({ item, onNavigate, level = 0 }: { item: NavItem; onNavigate: (href: string) => void; level?: number }) {
  return (
    <div style={{ paddingLeft: `${level * 16}px` }}>
      <button
        onClick={() => onNavigate(item.href)}
        className="w-full py-2 text-left text-sm hover:text-primary"
      >
        {item.label}
      </button>
      {item.subitems?.map((child) => (
        <TocEntry key={child.id || child.href} item={child} onNavigate={onNavigate} level={level + 1} />
      ))}
    </div>
  );
}

export function TocPanel({ toc, onNavigate }: TocPanelProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Table of Contents">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[320px] sm:w-[360px]">
        <SheetHeader>
          <SheetTitle>Table of Contents</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-80px)]">
          <div className="py-4">
            {toc.map((item) => (
              <TocEntry key={item.id || item.href} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
```

### Theme toggle with next-themes

```tsx
// src/components/reader/theme-toggle.tsx
'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sun, Moon, BookOpen } from 'lucide-react';

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-9 w-9" />; // placeholder

  const cycleTheme = () => {
    if (resolvedTheme === 'light') setTheme('sepia');
    else if (resolvedTheme === 'sepia') setTheme('dark');
    else setTheme('light');
  };

  return (
    <Button variant="ghost" size="icon" onClick={cycleTheme} aria-label="Cycle theme">
      {resolvedTheme === 'light' && <Sun className="h-5 w-5" />}
      {resolvedTheme === 'dark' && <Moon className="h-5 w-5" />}
      {resolvedTheme === 'sepia' && <BookOpen className="h-5 w-5" />}
    </Button>
  );
}
```

### Sepia theme CSS variables

Add to `src/app/globals.css`:

```css
.sepia {
  --background: #f4ecd8;
  --foreground: #5b4636;
  --card: #f4ecd8;
  --card-foreground: #5b4636;
  --popover: #f4ecd8;
  --popover-foreground: #5b4636;
  --primary: #5b4636;
  --primary-foreground: #f4ecd8;
  --secondary: #e9dfc6;
  --secondary-foreground: #5b4636;
  --muted: #e9dfc6;
  --muted-foreground: #8a7a6a;
  --accent: #e9dfc6;
  --accent-foreground: #5b4636;
  --border: #d4c5a9;
  --input: #d4c5a9;
  --ring: #8a7a6a;
}
```

### Prisma schema addition

```prisma
model UserBookPosition {
  id              String   @id @default(cuid())
  userId          String
  bookId          String
  paragraphIndex  Int
  charOffset      Int
  tocSectionId    String?  // optional: which TOC section for fast nav
  updatedAt       DateTime @updatedAt

  user User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  book EpubFile @relation(fields: [bookId], references: [id], onDelete: Cascade)

  @@unique([userId, bookId])
  @@index([userId])
  @@index([bookId])
}
```

Also add `positions UserBookPosition[]` to both `User` and `EpubFile` models.

## State of the Art

### EPUB rendering

`@likecoin/epub-ts` is the current state of the art for browser-based EPUB rendering. It is a complete TypeScript rewrite of `epubjs` v0.3.93 with:
- 56% smaller bundle (57.5KB vs 132.8KB gzipped)
- `locations.generate(1000)` is 99.6% faster (43s → 159ms for War and Peace)
- 970+ tests, active maintenance (last publish 3 weeks ago)
- Full API compatibility: `Book`, `Rendition`, `Themes`, `EpubCFI`, `Locations`, `Annotations`
- Browser and Node.js support (`@likecoin/epub-ts/node`)

`react-reader` wraps `epubjs` into a React class component. It provides pagination buttons, a built-in ToC panel, swipe gestures, and search. However:
- It hardcodes `epubjs` imports; cannot easily swap to `@likecoin/epub-ts` without bundler aliasing
- Its built-in ToC UI cannot be replaced with shadcn Sheet without significant override
- It is class-based, making hooks-based state sync cumbersome
- It bundles `react-swipeable` which disables text selection in the iframe

**Verdict:** Custom wrapper is the state-of-the-art approach for this stack.

### Content-based position tracking

Industry implementations:
- **Kindle:** Uses "location numbers" (roughly every 128 bytes of text) + page offsets. Locations survive font/size changes.
- **Apple Books:** Uses CFI internally with proprietary extensions.
- **Readium:** Uses CFI exclusively with `EpubCFI` class.
- **Google Play Books:** Uses a hybrid of section index + percentage within section.

Our paragraph index + char offset approach is content-based and survives reflow, matching the robustness of Kindle locations while being human-debuggable.

### next-themes multi-theme

`next-themes` v0.4.x supports arbitrary themes via the `themes` prop:
```tsx
<ThemeProvider attribute="class" themes={['light', 'dark', 'sepia']}>
```
When `setTheme('sepia')` is called, it adds `class="sepia"` to `<html>`. Tailwind v4's `@custom-variant dark (&:is(.dark *))` only handles dark mode; sepia requires manual CSS variable definitions.

## Open Questions

1. **Continuous scroll vs paginated?** `epub-ts` supports both (`flow: 'paginated'` or `flow: 'scrolled-doc'`). Paginated feels more like Kindle/Apple Books but scroll is simpler for position tracking. Agent's discretion per CONTEXT.md.

2. **Lazy vs eager paragraph map building?** Building the paragraph map for all sections upfront may cause a loading delay on large books. Building lazily (per section as visited) defers work but complicates jump-to-position from a different section.

3. **Should we store CFI as a fallback?** If paragraph-to-CFI mapping has edge cases (malformed HTML, missing `<p>` tags), storing the raw CFI alongside paragraph index provides a recovery path. Recommend storing both for v1.

4. **Mobile touch gestures?** Swipe left/right for page turn is expected on mobile. `react-reader` uses `react-swipeable` but it disables text selection. A custom implementation using `touchstart`/`touchend` on the container (outside the iframe) may be needed. Deferred to future version per D-08 agent discretion.

5. **Error handling for corrupted EPUB sections?** If a single spine item has malformed HTML, `epub-ts` may fail to render it. Should the reader skip the section with a warning, or show an error? Agent's discretion.

## Environment Availability

| Resource | Status | Notes |
|---|---|---|
| `@likecoin/epub-ts` | ✅ Installed (0.6.3) | Drop-in epubjs replacement |
| `next-themes` | ✅ Installed (0.4.6) | NOT wired up in Providers.tsx |
| shadcn Sheet | ✅ Installed | `src/components/ui/sheet.tsx` |
| shadcn ScrollArea | ✅ Installed | `src/components/ui/scroll-area.tsx` |
| shadcn Button | ✅ Installed | `src/components/ui/button.tsx` |
| shadcn Tooltip | ✅ Installed | `src/components/ui/tooltip.tsx` |
| Zustand | ✅ Installed (5.0.13) | For reader client state |
| React Query | ✅ Installed (5.100.9) | For position API caching |
| `tocJson` field | ✅ Available on `EpubFile` | Contains serialized hierarchical ToC |
| `epubPath` field | ✅ Available on `EpubFile` | Path to EPUB file on disk |
| File serving | ✅ `/api/files/` routes exist | Serve EPUB to browser |
| Auth guards | ✅ `requireAuth()` exists | Use in reader page |
| `UserBookPosition` model | ❌ Not in schema | Must add |
| `react-reader` | ❌ NOT installed | Do not install; build custom wrapper |
| `epubjs` | ❌ NOT installed | Do not install; use `@likecoin/epub-ts` |

## Validation Architecture

`nyquist_validation` is enabled in `.planning/config.json`. The following validation points must be verifiable:

1. **READ-01 (Excellent typography):** Reader renders EPUB HTML with CSS-injected themes. Visual inspection: no FOUT, readable line length (~65ch), proper margins. Automated: Playwright screenshot comparison of rendered text against baseline.

2. **READ-02 (Three themes):** Playwright test cycles through light → sepia → dark. Assert that `html` class changes and iframe body background color matches expected hex values. No page reload should occur (single-page React state change).

3. **READ-03 (Hierarchical ToC):** Playwright test opens Sheet, verifies nested structure matches `tocJson` data. Assert `SheetContent` is in DOM with `side="left"`.

4. **READ-04 (ToC navigation):** Playwright test clicks a ToC entry, asserts URL fragment or `rendition.display()` was called with expected href. Assert Sheet closes after click.

5. **READ-05 (Position resume):** Automated test: open book, navigate to a known paragraph, capture `paragraphIndex + charOffset`. Close and reopen book. Assert reader displays the same paragraph (within 1 paragraph tolerance). Change theme between close and reopen to verify reflow survival.

**Validation shortcuts:**
- Unit test `cfiToParagraphOffset` and `paragraphOffsetToCfi` with fixture EPUBs (Alice in Wonderland, War and Peace from Project Gutenberg).
- Unit test theme registration: assert `rendition.themes._current` matches selected theme.
- Integration test: Playwright flow from "My Library" → click book → click "Open Reader" → verify reader loads.

## Sources

- `@likecoin/epub-ts` README and dist types (node_modules inspection) — API compatibility, performance benchmarks, browser rendering confirmation
- `react-reader@2.0.15` npm tarball and README — API surface, dependency on epubjs, class-based architecture
- `epubjs@0.3.93` npm registry data — unmaintained status, bundle size, dependency tree
- `next-themes@0.4.6` README — multi-theme support, `attribute="class"`, hydration handling
- `@likecoin/epub-ts` GitHub: `likecoin/epub.ts` — CHANGELOG, AGENTS.md for AI integration guidance
- Stack Research (`.planning/research/STACK.md`) — version pins, compatibility matrix
- Architecture Research (`.planning/research/ARCHITECTURE.md`) — position-based resume pattern, anti-pattern warnings
- Pitfalls Research (`.planning/research/PITFALLS.md`) — scroll-percentage anti-pattern, EPUB parsing edge cases
- Existing codebase: `src/components/ui/sheet.tsx`, `src/components/ui/scroll-area.tsx`, `src/app/(library)/book/[id]/page.tsx`, `src/server/db/schema.prisma`

## Metadata

- **Phase:** 02-core-reading
- **Requirements covered:** READ-01, READ-02, READ-03, READ-04, READ-05
- **Blocking none**
- **Blocked by:** Phase 1 Foundation (completed)
- **Downstream blocked:** Phase 3 AI Explainers (needs reader for display), Phase 4 Reading Enhancements (needs reader for bookmarks/highlights)
- **Research confidence:** HIGH — all packages verified installed or intentionally excluded; `@likecoin/epub-ts` API confirmed via direct node_modules inspection; architecture patterns validated against existing codebase
- **Open questions:** 5 (all low-risk, agent discretion)
- **Estimated implementation complexity:** MEDIUM — custom wrapper (~200 LOC) + position mapping (~150 LOC) + theme sync (~50 LOC) + API routes + schema migration + UI components

---

## RESEARCH COMPLETE
