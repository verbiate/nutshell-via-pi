# Explainer Deep Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make explainer citations clickable so a reader can jump to the chapter/section the explainer references, and aggregate every citation in a discussion into a navigable "Links in this discussion" panel.

**Architecture:** Give the model a chapter manifest (`{{chapter_index}}`) so it emits markdown citation links `[Label](#ch:href)`; a pure `citations.ts` lib parses/validates/aggregates them (no schema change — citations live inline in cached explainer text); the reader already has `handleTocNavigate(href)` so navigation is reused, not rebuilt.

**Tech Stack:** Next.js 16 / React 19 / TypeScript 6, Vitest 4 (env: `node`, component tests use `renderToStaticMarkup` SSR — NOT jsdom), Prisma 5.22 (SQLite), shadcn/ui + Tailwind 4.

## Global Constraints

- **Test framework:** Vitest. Single file: `npx vitest run <path>`. Full suite: `npm test` (`vitest run`). Watch: `npm run test:watch`.
- **Test env is `node`** with `globals: true` (no `describe`/`it` import needed, but importing is harmless). `@/` alias resolves to `src/`. Component tests use `renderToStaticMarkup` from `react-dom/server` (see `src/components/reader/__tests__/reader-chrome.test.tsx` for the pattern). **Do NOT introduce jsdom or `@testing-library`.**
- **Typecheck:** `npx tsc --noEmit`. Lint: `npm run lint` (`eslint .`).
- **Citation scheme:** ONLY `[label](#ch:href)` links are intercepted. Anything else renders as plain text. Explainers must never become an arbitrary-link vector.
- **Validation:** citation hrefs are validated by **basename** against the spine (matches `hrefBasename` / the `buildSpinePlaylist` convention in `src/lib/reader/spine-playlist.ts`). Invalid → degrade to plain label text, never a dead jump.
- **No schema change.** Citations are ordinary text in `Explainer.content` / `ExplainerMessage.content`.
- **Cache invalidation** flows through `PromptTemplate.version` (folded into `contentHash`). The seed upserts for book/section/passage currently use `update: {}` — this plan changes them to populated `update` blocks (matching `book_pass2`) so re-seeding actually applies the new templates + versions.
- **DRY, YAGNI, TDD, frequent commits.** No comments unless asked EXCEPT the codebase uses `// ponytail:` comments to mark deliberate simplifications — follow that convention where a shortcut has a known ceiling.
- **Git:** work happens on branch `feat/explainer-deep-links` (already created). Commit per task (or per TDD cycle). Never commit on `main`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/explainer/citations.ts` *(new)* | Pure citation core: parse, validate-by-basename, segment, aggregate. The deterministic, fully-tested heart. |
| `src/lib/explainer/__tests__/citations.test.ts` *(new)* | Vitest unit tests for the above. |
| `src/server/services/prompt-builder.ts` *(modify)* | Add `buildChapterIndex(tocJson)`; thread `chapter_index` into book/section/passage `fillTemplate` calls. |
| `src/server/services/__tests__/prompt-builder.test.ts` *(new)* | Tests for `buildChapterIndex`. |
| `prisma/seed.ts` *(modify)* | Add `{{chapter_index}}` block + citation instructions to book/section/passage templates; add citation-preserve line to `book_pass2`; move all four into populated `update` blocks; bump versions (book 3→4, section 2→3, passage 2→3, book_pass2 2→3). |
| `src/components/explainer/explainer-content.tsx` *(new)* | Segmented renderer: turns `content` + spine + onNavigate into text/links. Exported for SSR testing. |
| `src/components/explainer/__tests__/explainer-content.test.tsx` *(new)* | SSR markup tests for inline link rendering + invalid-href degradation. |
| `src/components/explainer/discussion-links-panel.tsx` *(new)* | Aggregated "Links in this discussion" panel (deduped, spine-ordered). |
| `src/components/explainer/__tests__/discussion-links-panel.test.tsx` *(new)* | SSR markup tests for dedup + ordering. |
| `src/components/explainer/explainer-threads-panel.tsx` *(modify)* | Add `onNavigateToHref` + `spineItems` props; thread to `ThreadView`; `MessageBubble` uses `ExplainerContent`; `ThreadView` renders `DiscussionLinksPanel` (strip in sidebar / pane in modal). |
| `src/components/reader/reader-client.tsx` *(modify)* | Pass `onNavigateToHref={handleTocNavigate}` + `spineItems={spineItems}` into `ExplainerThreadsPanel` (mount at ~`:1500`). |

---

## Task 1: Citations core library (`src/lib/explainer/citations.ts`)

**Files:**
- Create: `src/lib/explainer/citations.ts`
- Test: `src/lib/explainer/__tests__/citations.test.ts`

**Interfaces:**
- Produces: `Citation`, `DiscussionLink`, `Segment` types; `hrefBasename(href)`, `parseCitations(text)`, `isValidHref(href, spineHrefs)`, `segmentText(text)`, `aggregateLinks(texts, spineItems)`. Later tasks import these.

- [ ] **Step 1: Write the failing tests** (`src/lib/explainer/__tests__/citations.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import {
  hrefBasename,
  parseCitations,
  isValidHref,
  segmentText,
  aggregateLinks,
} from "../citations";

describe("hrefBasename", () => {
  it("strips fragments, query, and path", () => {
    expect(hrefBasename("OEBPS/chapter1.xhtml#p4")).toBe("chapter1.xhtml");
    expect(hrefBasename("a/b/c.xhtml?x=1")).toBe("c.xhtml");
    expect(hrefBasename("c.xhtml")).toBe("c.xhtml");
  });
});

describe("parseCitations", () => {
  it("extracts #ch: markdown links in order", () => {
    const out = parseCitations("see [Chapter One](#ch:chapter1.xhtml) then [Two](#ch:c2.xhtml)");
    expect(out).toEqual([
      { label: "Chapter One", href: "chapter1.xhtml" },
      { label: "Two", href: "c2.xhtml" },
    ]);
  });

  it("ignores non-#ch: links and plain markdown", () => {
    expect(parseCitations("[real](https://example.com) and [x](#other)")).toEqual([]);
    expect(parseCitations("no links here")).toEqual([]);
  });

  it("handles empty text", () => {
    expect(parseCitations("")).toEqual([]);
  });
});

describe("isValidHref", () => {
  const spine = ["OEBPS/chapter1.xhtml", "chapter2.xhtml"];
  it("matches by basename", () => {
    expect(isValidHref("chapter1.xhtml", spine)).toBe(true);
    expect(isValidHref("OEBPS/chapter1.xhtml#frag", spine)).toBe(true);
  });
  it("rejects unknown hrefs", () => {
    expect(isValidHref("nope.xhtml", spine)).toBe(false);
    expect(isValidHref("", spine)).toBe(false);
  });
});

describe("segmentText", () => {
  it("splits text and links, preserving surrounding text", () => {
    const segs = segmentText("Before [Ch 1](#ch:c1.xhtml) after");
    expect(segs).toEqual([
      { type: "text", value: "Before " },
      { type: "link", label: "Ch 1", href: "c1.xhtml" },
      { type: "text", value: " after" },
    ]);
  });
  it("emits a single text segment when no citations", () => {
    expect(segmentText("plain text")).toEqual([{ type: "text", value: "plain text" }]);
  });
  it("does not segment non-#ch: links", () => {
    const segs = segmentText("[x](https://e.com)");
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("text");
  });
});

describe("aggregateLinks", () => {
  const spine = [
    { href: "c1.xhtml", index: 0 },
    { href: "c2.xhtml", index: 5 },
    { href: "c3.xhtml", index: 2 },
  ];
  it("dedupes by basename across messages and sorts by spine reading order", () => {
    const out = aggregateLinks(
      ["[A](#ch:c2.xhtml) [B](#ch:c3.xhtml)", "[dup](#ch:c2.xhtml)"],
      spine
    );
    // c3 (index 2) sorts before c2 (index 5); c2 deduped to a single entry.
    expect(out).toHaveLength(2);
    expect(out[0].href).toBe("c3.xhtml");
    expect(out[1].href).toBe("c2.xhtml");
  });
  it("drops hrefs not in the spine", () => {
    expect(aggregateLinks(["[x](#ch:ghost.xhtml)"], spine)).toEqual([]);
  });
  it("annotates spineIndex", () => {
    const out = aggregateLinks(["[x](#ch:c1.xhtml)"], spine);
    expect(out[0].spineIndex).toBe(0);
  });
});
```

NOTE: the first `aggregateLinks` assertion is intentionally awkward — replace the `["c1.xhtml" && "skip", ...].filter(...)` line before implementing; the explicit `toHaveLength(2)` + index checks below it are the real spec. Keep the explicit checks.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/explainer/__tests__/citations.test.ts`
Expected: FAIL — module `../citations` not found / exports undefined.

- [ ] **Step 3: Write the implementation** (`src/lib/explainer/citations.ts`)

```ts
// ponytail: pure citation core for explainer deep links. No React, no DB —
// the deterministic, fully-tested boundary. Components compose these fns.

export type Citation = { label: string; href: string };
export type DiscussionLink = Citation & { spineIndex: number };
export type Segment =
  | { type: "text"; value: string }
  | { type: "link"; label: string; href: string };

/** Only the #ch: scheme is honored — explainers stay citation-only, never an
 *  arbitrary external-link vector. */
const CITE_RE = /\[([^\]]+)\]\(#ch:([^)\s]+)\)/g;

/** Normalize an href to its basename for spine matching. Mirrors the
 *  basename convention in lib/reader/spine-playlist.ts so ToC hrefs (which
 *  may carry path/fragment noise) resolve against spine hrefs cleanly. */
export function hrefBasename(href: string): string {
  return href.split("#")[0].split("?")[0].split("/").pop() ?? "";
}

export function parseCitations(text: string): Citation[] {
  const out: Citation[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    out.push({ label: m[1], href: m[2] });
  }
  return out;
}

export function isValidHref(href: string, spineHrefs: string[]): boolean {
  const b = hrefBasename(href);
  if (!b) return false;
  return spineHrefs.some((s) => hrefBasename(s) === b);
}

export function segmentText(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ type: "text", value: text.slice(last, idx) });
    segments.push({ type: "link", label: m[1], href: m[2] });
    last = idx + m[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

/** Aggregate citations across many message texts: drop invalid hrefs, dedupe
 *  by basename (first occurrence wins), sort by spine reading order. */
export function aggregateLinks(
  texts: string[],
  spineItems: { href: string; index: number }[]
): DiscussionLink[] {
  const indexByBasename = new Map<string, number>();
  for (const s of spineItems) {
    const b = hrefBasename(s.href);
    if (b && !indexByBasename.has(b)) indexByBasename.set(b, s.index);
  }
  const seen = new Set<string>();
  const links: DiscussionLink[] = [];
  for (const text of texts) {
    for (const c of parseCitations(text)) {
      const b = hrefBasename(c.href);
      const idx = indexByBasename.get(b);
      if (idx === undefined) continue;
      if (seen.has(b)) continue;
      seen.add(b);
      links.push({ label: c.label, href: c.href, spineIndex: idx });
    }
  }
  links.sort((a, z) => a.spineIndex - z.spineIndex);
  return links;
}

// ponytail: self-check. Run: npx tsx src/lib/explainer/citations.ts
if (process.argv[1]?.endsWith("citations.ts")) {
  const c = parseCitations("see [Chapter One](#ch:chapter1.xhtml) and [Two](#ch:c2.xhtml)");
  if (c.length !== 2) throw new Error("parseCitations failed");
  if (!isValidHref("chapter1.xhtml", ["OEBPS/chapter1.xhtml"])) throw new Error("isValidHref true");
  if (isValidHref("nope.xhtml", ["chapter1.xhtml"])) throw new Error("isValidHref false");
  const agg = aggregateLinks(
    ["[A](#ch:c2.xhtml) [B](#ch:c1.xhtml)", "[dup](#ch:c2.xhtml)"],
    [
      { href: "c1.xhtml", index: 0 },
      { href: "c2.xhtml", index: 5 },
    ]
  );
  if (agg.length !== 2 || agg[0].href !== "c1.xhtml" || agg[1].href !== "c2.xhtml") {
    throw new Error("aggregateLinks failed");
  }
  console.log("citations self-check OK");
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/explainer/__tests__/citations.test.ts`
Expected: PASS, all green, no warnings.

- [ ] **Step 5: Run the self-check**

Run: `npx tsx src/lib/explainer/citations.ts`
Expected: prints `citations self-check OK`.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add src/lib/explainer/citations.ts src/lib/explainer/__tests__/citations.test.ts
git commit -m "feat(explainer): add citations parsing core for deep links"
```

---

## Task 2: Chapter manifest in prompts (`buildChapterIndex` + seed)

**Files:**
- Modify: `src/server/services/prompt-builder.ts`
- Modify: `prisma/seed.ts`
- Test: `src/server/services/__tests__/prompt-builder.test.ts`

**Interfaces:**
- Consumes: `hrefBasename` from `@/lib/explainer/citations` (Task 1).
- Produces: `buildChapterIndex(tocJson, cap?)` exported from `prompt-builder.ts`; `chapter_index` var threaded into `buildBookPrompt`, `buildSectionPrompt`, `buildPassagePrompt`.

- [ ] **Step 1: Write failing tests** (`src/server/services/__tests__/prompt-builder.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { buildChapterIndex } from "../prompt-builder";

describe("buildChapterIndex", () => {
  it("renders a numbered manifest of top-level ToC entries", () => {
    const toc = JSON.stringify([
      { label: "Chapter One", href: "chapter1.xhtml" },
      { label: "Chapter Two", href: "OEBPS/chapter2.xhtml" },
    ]);
    expect(buildChapterIndex(toc)).toBe(
      "[1] Chapter One → chapter1.xhtml\n[2] Chapter Two → chapter2.xhtml"
    );
  });

  it("ignores subitems (top-level only) and strips fragments", () => {
    const toc = JSON.stringify([
      { label: "Part One", href: "part1.xhtml#top", subitems: [{ label: "Ch A", href: "a.xhtml" }] },
    ]);
    expect(buildChapterIndex(toc)).toBe("[1] Part One → part1.xhtml");
  });

  it("skips entries missing label or href", () => {
    const toc = JSON.stringify([{ label: "Ok", href: "ok.xhtml" }, { label: "No href" }, { href: "x.xhtml" }]);
    expect(buildChapterIndex(toc)).toBe("[1] Ok → ok.xhtml");
  });

  it("caps the number of entries", () => {
    const toc = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ label: `C${i}`, href: `c${i}.xhtml` })));
    expect(buildChapterIndex(toc, 2)).toBe("[1] C0 → c0.xhtml\n[2] C1 → c1.xhtml");
  });

  it("returns empty string for null / malformed JSON / non-array", () => {
    expect(buildChapterIndex(null)).toBe("");
    expect(buildChapterIndex("not json")).toBe("");
    expect(buildChapterIndex("{}")).toBe("");
    expect(buildChapterIndex("[]")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/services/__tests__/prompt-builder.test.ts`
Expected: FAIL — `buildChapterIndex` is not exported.

- [ ] **Step 3: Implement `buildChapterIndex` + thread `chapter_index`** (in `src/server/services/prompt-builder.ts`)

Add the import at top:
```ts
import { hrefBasename } from "@/lib/explainer/citations";
```

Add the function (place near `formatExpandedMetadata`):
```ts
type TocItem = { label?: string; href?: string; subitems?: TocItem[] };

/**
 * Build the {{chapter_index}} manifest so the model can cite navigable
 * locations. Top-level ToC entries only (subitems ignored), hrefs normalized
 * to basenames, capped to bound prompt size. Empty string when no usable ToC.
 */
export function buildChapterIndex(
  tocJson: string | null | undefined,
  cap = 200
): string {
  if (!tocJson) return "";
  let toc: TocItem[];
  try {
    toc = JSON.parse(tocJson);
  } catch {
    return "";
  }
  if (!Array.isArray(toc)) return "";
  const lines: string[] = [];
  for (const item of toc) {
    if (lines.length >= cap) break;
    const label = (item.label ?? "").trim();
    const href = (item.href ?? "").split("#")[0].trim();
    if (!label || !href) continue;
    lines.push(`[${lines.length + 1}] ${label} → ${hrefBasename(href)}`);
  }
  return lines.length === 0 ? "" : lines.join("\n");
}
```

In `buildBookPrompt`, add to the `fillTemplate` vars object:
```ts
    chapter_index: buildChapterIndex(book.tocJson),
```
Do the same in `buildSectionPrompt` and `buildPassagePrompt`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/server/services/__tests__/prompt-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the seed templates** (`prisma/seed.ts`)

For each of the **book**, **section**, **passage** upserts: change `update: {}` to a populated `update: { content: <NEW>, version: <N+1> }` (mirroring the `book_pass2` pattern), set the same `content`+`version` in `create`, and append the chapter-map + citation block to `content`. New versions: **book 4**, **section 3**, **passage 3**.

Append this block to the **book** template `content` (before the closing instruction), adjusting the lead-in to fit:

```
\n\nThe book's chapter map:\n{{chapter_index}}\n\nWhen you reference where something occurs in the book (a chapter, section, or scene), cite it as a markdown link using ONLY hrefs that appear in the chapter map above, in the exact form [Chapter One](#ch:chapter1.xhtml). Cite only when you genuinely reference a location — do not pad with citations, and never invent an href that is not in the map. Use the natural-language label as the link text.
```

Use the same block for **section** and **passage** templates.

For **book_pass2**: add a populated `update` (already has one) — append this line to its `content` and bump version 2→3:

```
\n\nPreserve any [..](#ch:..) citation links present in the first draft verbatim; do not strip or rewrite them.
```

- [ ] **Step 6: Apply the seed and verify version bumps took**

Run: `npm run db:seed`
Then verify (this is the cache-invalidation guarantee — the populated `update` must have overwritten the rows):
```
npx tsx -e "import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); p.promptTemplate.findMany({ where: { type: { in: ['book','section','passage','book_pass2'] } }, select: { type: true, version: true, content: true }}).then(r => { for (const t of r) console.log(t.type, 'v'+t.version, t.content.includes('chapter_index') || t.type==='book_pass2' && t.content.includes('#ch:') ); });"
```
Expected: prints `book v4 true`, `section v3 true`, `passage v3 true`, `book_pass2 v3 true` (booleans confirm the new content landed).

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add src/server/services/prompt-builder.ts src/server/services/__tests__/prompt-builder.test.ts prisma/seed.ts
git commit -m "feat(explainer): inject chapter manifest into prompts for citation links"
```

---

## Task 3: Inline citation links in messages (`ExplainerContent` + wiring)

**Files:**
- Create: `src/components/explainer/explainer-content.tsx`
- Test: `src/components/explainer/__tests__/explainer-content.test.tsx`
- Modify: `src/components/explainer/explainer-threads-panel.tsx` (use `ExplainerContent` in `MessageBubble`; add + thread `onNavigateToHref`, `spineItems` props)
- Modify: `src/components/reader/reader-client.tsx` (pass the two new props at the `ExplainerThreadsPanel` mount)

**Interfaces:**
- Consumes: `segmentText`, `isValidHref` from `@/lib/explainer/citations` (Task 1).
- Produces: `<ExplainerContent content spineHrefs onNavigateToHref? />` — renders text runs + validated links; invalid hrefs degrade to plain label text.

- [ ] **Step 1: Write failing SSR test** (`src/components/explainer/__tests__/explainer-content.test.tsx`)

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExplainerContent } from "../explainer-content";

const spine = ["chapter1.xhtml", "chapter2.xhtml"];

describe("ExplainerContent", () => {
  it("renders a valid citation as a link that signals navigation", () => {
    const html = renderToStaticMarkup(
      <ExplainerContent
        content="See [Chapter One](#ch:chapter1.xhtml) for more."
        spineHrefs={spine}
        onNavigateToHref={() => {}}
      />
    );
    expect(html).toContain("Chapter One");
    expect(html).toContain("data-href=\"chapter1.xhtml\"");
    expect(html).toContain("role=\"button\"");
  });

  it("degrades an invalid citation href to plain text", () => {
    const html = renderToStaticMarkup(
      <ExplainerContent
        content="See [Ghost](#ch:ghost.xhtml)."
        spineHrefs={spine}
        onNavigateToHref={() => {}}
      />
    );
    expect(html).toContain("Ghost");
    expect(html).not.toContain("data-href");
    expect(html).not.toContain("role=\"button\"");
  });

  it("renders plain text unchanged when there are no citations", () => {
    const html = renderToStaticMarkup(
      <ExplainerContent content="just text" spineHrefs={spine} />
    );
    expect(html).toContain("just text");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/explainer/__tests__/explainer-content.test.tsx`
Expected: FAIL — `ExplainerContent` not found.

- [ ] **Step 3: Implement `ExplainerContent`** (`src/components/explainer/explainer-content.tsx`)

```tsx
import { segmentText, isValidHref } from "@/lib/explainer/citations";

/**
 * Renders explainer text with inline citation links. Valid #ch: citations
 * (basename present in spineHrefs) become buttons that call onNavigateToHref;
 * invalid ones degrade to plain label text (never a dead jump). Non-#ch:
 * markdown and plain text render verbatim.
 *
 * ponytail: a <span role="button"> (not <a>) because navigation is in-app
 * via the reader's navigateTo(href), not a URL change. data-href carries the
 * target for tests + future debugging.
 */
export function ExplainerContent({
  content,
  spineHrefs,
  onNavigateToHref,
}: {
  content: string;
  spineHrefs: string[];
  onNavigateToHref?: (href: string) => void;
}) {
  const segments = segmentText(content);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.value}</span>;
        if (!isValidHref(seg.href, spineHrefs) || !onNavigateToHref) {
          return <span key={i}>{seg.label}</span>;
        }
        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            data-href={seg.href}
            className="cursor-pointer underline decoration-primary/60 underline-offset-2 hover:decoration-primary"
            onClick={() => onNavigateToHref(seg.href)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNavigateToHref(seg.href);
              }
            }}
          >
            {seg.label}
          </span>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/components/explainer/__tests__/explainer-content.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into `MessageBubble` + add/thread props**

In `src/components/explainer/explainer-threads-panel.tsx`:

1. Add imports at top:
```tsx
import type { SpineItem } from "@/lib/reader/spine-playlist";
import { ExplainerContent } from "./explainer-content";
```

2. Add to `ExplainerThreadsPanelProps`:
```tsx
  onNavigateToHref?: (href: string) => void;
  spineItems?: SpineItem[];
```

3. Destructure them in `ExplainerThreadsPanel` and pass through `renderPanelContent` → `<ThreadView ... onNavigateToHref={onNavigateToHref} spineItems={spineItems} />`.

4. Add `onNavigateToHref?: (href: string) => void;` and `spineItems?: SpineItem[];` to `ThreadView`'s props type, destructure, and derive `const spineHrefs = (spineItems ?? []).map((s) => s.href);`.

5. In `MessageBubble`: add `spineHrefs: string[]` and `onNavigateToHref?: (href: string) => void` to its props, and replace the `{content || (pulsing ? ... : "")}` body's `{content}` with `<ExplainerContent content={content} spineHrefs={spineHrefs} onNavigateToHref={onNavigateToHref} />` (keep the `pulsing` dots fallback when `!content`). Pass `spineHrefs` + `onNavigateToHref` down from `ThreadView` at every `<MessageBubble>` call site (initial bubble + the mapped follow-ups).

In `src/components/reader/reader-client.tsx`, at the `<ExplainerThreadsPanel>` mount (~line 1500), add:
```tsx
                onNavigateToHref={handleTocNavigate}
                spineItems={spineItems}
```
(`handleTocNavigate` already exists at `:535`; `spineItems` state is set at `:545`. Reusing `handleTocNavigate` is deliberate — same path the ToC uses, zero new navigation code.)

- [ ] **Step 6: Typecheck + run affected tests**

Run: `npx tsc --noEmit && npx vitest run src/components/explainer`
Expected: PASS, type-clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/explainer/explainer-content.tsx \
        src/components/explainer/__tests__/explainer-content.test.tsx \
        src/components/explainer/explainer-threads-panel.tsx \
        src/components/reader/reader-client.tsx
git commit -m "feat(explainer): render inline citation links in discussion messages"
```

---

## Task 4: "Links in this discussion" panel (`DiscussionLinksPanel`)

**Files:**
- Create: `src/components/explainer/discussion-links-panel.tsx`
- Test: `src/components/explainer/__tests__/discussion-links-panel.test.tsx`
- Modify: `src/components/explainer/explainer-threads-panel.tsx` (render the panel inside `ThreadView`)

**Interfaces:**
- Consumes: `aggregateLinks` from `@/lib/explainer/citations` (Task 1); `spineItems` + `onNavigateToHref` threaded in Task 3.
- Produces: `<DiscussionLinksPanel texts spineItems onNavigateToHref />` — deduped, spine-ordered clickable list. Empty list → renders nothing.

- [ ] **Step 1: Write failing SSR test** (`src/components/explainer/__tests__/discussion-links-panel.test.tsx`)

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscussionLinksPanel } from "../discussion-links-panel";

const spine = [
  { href: "c1.xhtml", index: 0 },
  { href: "c2.xhtml", index: 5 },
  { href: "c3.xhtml", index: 2 },
];

describe("DiscussionLinksPanel", () => {
  it("renders deduped links in spine reading order", () => {
    const html = renderToStaticMarkup(
      <DiscussionLinksPanel
        texts={["[A](#ch:c2.xhtml) [B](#ch:c3.xhtml)", "[dup](#ch:c2.xhtml)"]}
        spineItems={spine}
        onNavigateToHref={() => {}}
      />
    );
    // c3 (index 2) before c2 (index 5); c2 deduped.
    const aPos = html.indexOf("c3.xhtml");
    const bPos = html.indexOf("c2.xhtml");
    expect(aPos).toBeGreaterThan(-1);
    expect(bPos).toBeGreaterThan(-1);
    expect(aPos).toBeLessThan(bPos);
    // exactly two entries
    expect(html.match(/role="button"/g)).toHaveLength(2);
  });

  it("renders nothing when there are no valid citations", () => {
    const html = renderToStaticMarkup(
      <DiscussionLinksPanel texts={["no links", "[g](#ch:ghost.xhtml)"]} spineItems={spine} onNavigateToHref={() => {}} />
    );
    expect(html.trim()).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/explainer/__tests__/discussion-links-panel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `DiscussionLinksPanel`** (`src/components/explainer/discussion-links-panel.tsx`)

```tsx
import { useMemo } from "react";
import { aggregateLinks } from "@/lib/explainer/citations";
import { BookOpen } from "lucide-react";

/**
 * Aggregated "Links in this discussion" — every citation across the supplied
 * message texts, deduped by basename and ordered by spine reading order so the
 * panel doubles as a map of how far the discussion reaches. Renders nothing
 * when there are no valid citations.
 */
export function DiscussionLinksPanel({
  texts,
  spineItems,
  onNavigateToHref,
}: {
  texts: string[];
  spineItems: { href: string; index: number }[];
  onNavigateToHref?: (href: string) => void;
}) {
  const links = useMemo(
    () => aggregateLinks(texts, spineItems),
    [texts, spineItems]
  );
  if (links.length === 0) return null;
  return (
    <div className="border-b border-border px-4 py-2">
      <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <BookOpen className="h-3 w-3" />
        Links in this discussion
      </p>
      <ul className="space-y-0.5">
        {links.map((l) => (
          <li key={l.href}>
            <button
              type="button"
              disabled={!onNavigateToHref}
              onClick={() => onNavigateToHref?.(l.href)}
              className="block w-full truncate text-left text-xs text-primary/90 hover:text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              title={l.label}
            >
              {l.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/components/explainer/__tests__/discussion-links-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Render the panel inside `ThreadView`**

In `src/components/explainer/explainer-threads-panel.tsx`:

1. Add import: `import { DiscussionLinksPanel } from "./discussion-links-panel";`

2. In `ExplainerThreadsPanel` (the parent — where `setPoppedOut` is in scope), wrap `onNavigateToHref` so a jump from the panel also closes the pop-out modal to reveal the reader. Pass this wrapped callback down to `<ThreadView>`:

```tsx
const navigateAndCloseModal = onNavigateToHref
  ? (href: string) => {
      onNavigateToHref(href);
      setPoppedOut(false);
    }
  : undefined;
```
(Add this near the other derived handlers in `ExplainerThreadsPanel`, and pass `onNavigateToHref={navigateAndCloseModal}` into `<ThreadView>`.)

3. Inside `ThreadView`'s return, place `<DiscussionLinksPanel>` directly **above** the scrollable messages container (`<div ref={scrollRef} ...>`). `ThreadView` already receives `spineItems` and `onNavigateToHref` (from Task 3 + the wrap above) — forward them:

```tsx
<DiscussionLinksPanel
  texts={[initialContent, ...messages.map((m) => m.content)]}
  spineItems={spineItems ?? []}
  onNavigateToHref={onNavigateToHref}
/>
```

`ThreadView` does NOT branch on `inModal` — the modal-close happens in the parent wrapper. `DiscussionLinksPanel` renders nothing when there are no valid citations, so empty discussions are unaffected.

- [ ] **Step 6: Typecheck + run full explainer test suite**

Run: `npx tsc --noEmit && npx vitest run src/components/explainer`
Expected: PASS, type-clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/explainer/discussion-links-panel.tsx \
        src/components/explainer/__tests__/discussion-links-panel.test.tsx \
        src/components/explainer/explainer-threads-panel.tsx
git commit -m "feat(explainer): add 'Links in this discussion' aggregate panel"
```

---

## Definition of Done (all tasks)

- [ ] `npm test` green (full suite)
- [ ] `npm run lint` clean
- [ ] `npx tsc --noEmit` clean
- [ ] Seed applied; template versions bumped (book 4, section 3, passage 3, book_pass2 3)
- [ ] Manual: open a book, start a discussion, ask "what chapter does the author describe X?", confirm the answer has a clickable citation that jumps the reader, and the "Links in this discussion" panel lists it.
