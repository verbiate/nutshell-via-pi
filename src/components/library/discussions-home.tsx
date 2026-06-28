"use client";

// ponytail: homepage Discussions tab. Flat chronological list of every
// discussion the user owns (across all their books). Swap-in-place detail
// view (list ⇄ thread). Context chips (origin book + attached books +
// attached sections) are clickable and route to the reader via the SAME
// pendingReaderNav deep-link the in-reader citation clicks already use
// (reader-client.tsx:590). No new reader-side plumbing — reuses the root
// ReaderNavProvider.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Lightbulb,
  ArrowLeft,
  BookOpen,
  FileText,
  Quote,
  Library,
  Loader2,
  Send,
  Plus,
  X,
} from "lucide-react";
import { BookCover } from "./book-cover";
import { ExplainerContent } from "../explainer/explainer-content";
import { SmoothScrollArea } from "./smooth-scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useReaderNav } from "@/components/reader/reader-nav-context";
import { hrefBasename } from "@/lib/explainer/citations";
import type { DiscussionListItem } from "@/types/discussion";
import type { LibraryBook } from "@/types/book";

// ponytail: in-flight message shape. createdAt is optional — synthesized
// during streaming, replaced with server truth on refetch. Mirrors the panel.
type Message = { role: "user" | "assistant"; content: string; createdAt?: string };

interface Props {
  discussions: DiscussionListItem[];
  // ponytail: switches the parent Tabs to "bookshelf" — used by the empty
  // state CTA. Optional so the component can render standalone.
  onGoToBookshelf?: () => void;
  // ponytail: user's library — feeds the composer's "Other book" attach
  // picker. Optional so the component can render standalone (tests).
  books?: LibraryBook[];
  // ponytail: draft hand-off from the shelf bar. When non-null, the view
  // mounts a ShelfDraftDetail that POSTs + streams the first answer live.
  // Cleared via onPendingShelfConsumed once the child seeds its draft state.
  pendingShelfQuestion?: string | null;
  onPendingShelfConsumed?: () => void;
}

type NavigateFn = (
  bookId: string,
  opts: { href?: string; discussionId: string }
) => void;

// ponytail: real tocJson rows are flat {id, title, href, level, subitems?}.
// Hoisted so both the list-view resolveLabel walker and the detail-view
// section picker share the shape.
type TocItem = { href?: string; label?: string; title?: string; subitems?: TocItem[] };

// ponytail: dual-ownership title treatment. A discussion seeded with a second
// book shows BOTH covers and this label instead of one title + an attachment
// chip. Exactly two → "Two books:" (product wording); 3+ → "N books:".
function booksLabel(titles: string[]): string {
  if (titles.length === 2) return `Two books: ${titles[0]} + ${titles[1]}`;
  if (titles.length > 2) return `${titles.length} books: ${titles.join(" + ")}`;
  return titles[0] ?? "";
}

export function DiscussionsHomeView({
  discussions: initial,
  onGoToBookshelf,
  books = [],
  pendingShelfQuestion,
  onPendingShelfConsumed,
}: Props) {
  const router = useRouter();
  const { markPendingReaderNav } = useReaderNav();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  // ponytail: shelf-bar draft hand-off target. The consume effect copies the
  // prop into local draftQuestion + flips activeId to the draft sentinel so
  // ShelfDraftDetail persists after the parent clears the prop. The render
  // branch below also reads the prop directly (draftQ) so the draft mounts on
  // the FIRST hand-off render — without that, a useEffect (passive, post-
  // paint) would flash the empty-state/list for one frame before the draft.
  const [draftQuestion, setDraftQuestion] = useState<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!pendingShelfQuestion) return;
    setDraftQuestion(pendingShelfQuestion);
    setActiveId("draft:shelf");
    onPendingShelfConsumed?.();
  }, [pendingShelfQuestion, onPendingShelfConsumed]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ponytail: refetch on mount so a reader→library return shows fresh
  // updatedAt ordering. SSR data seeds initialData so there's no flash.
  // staleTime:0 overrides the global 60s — without it, a soft-nav return
  // keeps the original SSR seed (which `router.refresh()` can't update,
  // since useQuery ignores initialData changes after mount) and the user
  // sees stale rows until the global staleTime expires.
  const { data } = useQuery({
    queryKey: ["discussions-all"],
    queryFn: async () => {
      const res = await fetch("/api/discussions");
      if (!res.ok) throw new Error("Failed to load discussions");
      return (await res.json()) as { discussions: DiscussionListItem[] };
    },
    initialData: { discussions: initial },
    staleTime: 0,
  });
  const discussions = data.discussions ?? initial;

  // ponytail: build a (bookId, basename) → ToC label map once per dataset.
  // Used to resolve section pill labels client-side without a round-trip —
  // mirrors the canonical walk in services/discussions.ts:1012-1024
  // (buildAttachmentSuffix). Real tocJson rows are flat {id, title, href,
  // level, subitems?} — `title` is the populated field, `label` is a legacy
  // fallback. Nested chapters live in `subitems` so the walk recurses.
  // First-occurrence wins so a top-level entry isn't shadowed by a nested
  // duplicate. Books without tocJson silently contribute nothing; pills
  // fall back to the raw basename.
  const resolveLabel = useMemo(() => {
    const map = new Map<string, string>();
    const seen = new Set<string>();
    const ingest = (b: { id: string; tocJson: string | null } | null | undefined) => {
      if (!b || seen.has(b.id) || !b.tocJson) return;
      seen.add(b.id);
      let toc: TocItem[];
      try {
        toc = JSON.parse(b.tocJson);
      } catch {
        return;
      }
      if (!Array.isArray(toc)) return;
      const walk = (items: TocItem[]) => {
        for (const item of items) {
          const bn = hrefBasename(item.href ?? "");
          if (bn && !map.has(`${b.id}|${bn}`)) {
            const label = (item.label ?? item.title ?? "").trim();
            if (label) map.set(`${b.id}|${bn}`, label);
          }
          if (Array.isArray(item.subitems)) walk(item.subitems);
        }
      };
      walk(toc);
    };
    for (const d of discussions) {
      ingest(d.book);
      for (const a of d.attachments) ingest(a.book);
    }
    return (bookId: string, href: string) =>
      map.get(`${bookId}|${hrefBasename(href)}`);
  }, [discussions]);

  // ponytail: every chip routes through the same pendingReaderNav deep-link.
  // href set → destination viewer navigates to that section basename.
  // href omitted → destination restores saved position (handleOpenBook path
  // in reader-client.tsx:571). discussionId always passed so the reader
  // opens the bulb panel with this thread on arrival.
  const navigate: NavigateFn = (bookId, opts) => {
    markPendingReaderNav({
      bookId,
      href: opts?.href,
      discussionId: opts.discussionId,
    });
    router.push(`/book/${bookId}/reader`);
  };

  // ponytail: draft question — prop-driven on the first hand-off render
  // (avoids a one-frame empty-state flash before the consume effect runs),
  // state-driven thereafter. Stable key so ShelfDraftDetail doesn't remount
  // across the prop → state transition (its stream is guarded either way).
  const draftQ = pendingShelfQuestion ?? draftQuestion;

  // ponytail: shelf-bar draft hand-off — render BEFORE the empty-state so a
  // brand-new user asking their first shelf question sees the streaming draft,
  // not "No discussions yet". Chat-shaped detail views (draft / stub / found)
  // share the NO-SmoothScrollArea rule: DiscussionDetail's flex-col + overflow
  // middle needs height from TabsContent (lg:absolute lg:inset-0) so the
  // composer anchors to the bottom (mirrors reader-sidebar.tsx:116-126).
  if ((activeId === "draft:shelf" || pendingShelfQuestion) && draftQ) {
    return (
      <div className="h-full min-h-[60vh] lg:min-h-0">
        <ShelfDraftDetail
          key={draftQ}
          question={draftQ}
          onPinned={(id) => {
            // ponytail: pin fires from the child's finally (post-stream) so
            // the per-thread GET can't race in and clobber the streaming
            // bubble. Invalidating here lands the new row so find() hits and
            // the real DiscussionDetail takes over from the missing-row stub.
            setActiveId(id);
            setDraftQuestion(null);
            queryClient.invalidateQueries({ queryKey: ["discussions-all"] });
          }}
          onBack={() => {
            setActiveId(null);
            setDraftQuestion(null);
          }}
        />
      </div>
    );
  }

  const active = activeId && activeId !== "draft:shelf"
    ? discussions.find((d) => d.id === activeId)
    : undefined;

  // ponytail: missing-row stub — after onPinned(id) the new shelf row isn't in
  // `discussions` until ["discussions-all"] refetches, so find() misses and
  // DiscussionDetail wouldn't mount. Synthesize a minimal shelf stub so it
  // mounts and its ["discussion", id] GET loads the persisted thread. Only
  // shelf reaches here: book/section/passage ids always come from the list
  // (already fetched), so a missing find is exclusively the shelf-draft pin race.
  if (activeId && activeId !== "draft:shelf" && !active) {
    return (
      <div className="h-full min-h-[60vh] lg:min-h-0">
        <DiscussionDetail
          discussion={shelfDiscussionStub(activeId)}
          onBack={() => setActiveId(null)}
          navigate={navigate}
          resolveLabel={resolveLabel}
          books={books}
        />
      </div>
    );
  }

  if (active) {
    return (
      <div className="h-full min-h-[60vh] lg:min-h-0">
        <DiscussionDetail
          discussion={active}
          onBack={() => setActiveId(null)}
          navigate={navigate}
          resolveLabel={resolveLabel}
          books={books}
        />
      </div>
    );
  }

  if (discussions.length === 0) {
    return (
      <div className="flex h-full min-h-[50vh] flex-col items-center justify-center lg:min-h-0">
        <Lightbulb className="h-16 w-16 text-muted-foreground" />
        <h2 className="mt-4 font-serif text-[28px] font-medium text-espresso">
          No discussions yet
        </h2>
        <p className="mt-2 max-w-[400px] text-center text-base text-muted-foreground">
          Open a book and click &ldquo;Explain this&rdquo; or start a new discussion to see it here.
        </p>
        {onGoToBookshelf && (
          <button
            type="button"
            onClick={onGoToBookshelf}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-grad px-5 py-2 text-sm font-semibold text-white shadow-[0_12px_28px_-12px_rgba(241,104,245,.6)] transition-transform hover:saturate-110 active:translate-y-px"
          >
            <BookOpen className="h-4 w-4" />
            Go to Bookshelf
          </button>
        )}
      </div>
    );
  }

  // ponytail: list view — wrap in SmoothScrollArea so the list scrolls with
  // the custom scrollbar + Lenis smoothing, matching the Bookshelf tab.
  return (
    <SmoothScrollArea className="h-full lg:absolute lg:inset-0">
      <DiscussionList
        discussions={discussions}
        onSelect={setActiveId}
        navigate={navigate}
        resolveLabel={resolveLabel}
      />
    </SmoothScrollArea>
  );
}

// ─── Shelf-bar draft detail ─────────────────────────────────────────────────

// ponytail: the landing view for a shelf-bar Enter. Owns the POST + first-
// answer SSE stream (mirrors discussions-panel.tsx sendDraftMessage:749-860).
// Seeded optimistically with the user's question + an empty assistant bubble;
// pins the real id back to the parent only in finally (post-stream) so the
// per-thread GET can't race in and clobber the streaming bubble. No composer —
// once pinned, the real DiscussionDetail mounts with the full thread +
// follow-up composer. Reuses MessageBubble for identical bubble treatment.
function ShelfDraftDetail({
  question,
  onPinned,
  onBack,
}: {
  question: string;
  onPinned: (id: string) => void;
  onBack: () => void;
}) {
  const [localMessages, setLocalMessages] = useState<Message[]>(() => {
    const nowIso = new Date().toISOString();
    return [
      { role: "user", content: question, createdAt: nowIso },
      { role: "assistant", content: "", createdAt: nowIso },
    ];
  });
  // ponytail: assistantIndex is always 1 (user msg at 0). Index-patch is
  // mandatory — object-reference equality breaks after the first chunk
  // (lesson from playground/page.tsx + sendFollowup).
  const assistantIndex = 1;
  const [streaming, setStreaming] = useState(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // ponytail: pinnedRef guards a double onPinned if finally ever ran twice.
  const pinnedRef = useRef(false);

  /* eslint-disable react-hooks/exhaustive-deps */
  // ponytail: no fire-once guard — effect intentionally re-fires after the
  // StrictMode cleanup-then-restart cycle (mount₁ POST₁ → cleanup abort₁ →
  // remount POST₂ streams + pins). A startedRef guard would early-return on
  // remount and leave a dead stream in dev. Tradeoff: POST₁'s abort creates
  // one orphan shelf discussion server-side (the row is created before the
  // stream starts; the client never pins it because !controller.signal.aborted
  // suppresses the pin in finally). Dev-only noise — production is single-
  // mount, no orphan, clean stream. The dead-stream bug is the worse outcome.
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    let newDiscussionId: string | null = null;
    let errored = false;
    let acc = "";

    (async () => {
      try {
        const res = await fetch("/api/discussions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "shelf", message: question }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          errored = true;
          setStreamError(res.ok ? "No response stream." : `Failed (${res.status})`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]" || !payload) continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.type === "discussion" && parsed.discussionId) {
                newDiscussionId = parsed.discussionId;
              } else if (parsed.type === "chunk" && parsed.chunk) {
                acc += parsed.chunk;
                const snapshot = acc;
                setLocalMessages((prev) =>
                  prev.map((m, i) =>
                    i === assistantIndex ? { ...m, content: snapshot } : m
                  )
                );
              } else if (parsed.type === "error") {
                errored = true;
                setStreamError(parsed.error || "The stream failed.");
                return;
              }
            } catch {
              // skip malformed SSE line
            }
          }
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          errored = true;
          setStreamError(err?.message || "Network error.");
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        // ponytail: pin in finally, AFTER the stream ends — pinning on the
        // `discussion` event lets the per-thread GET race in and clobber the
        // streaming bubble (discussions-panel.tsx:855-858 discipline). Skip
        // pin on error/abort so the user stays on the draft with the partial
        // bubble + the in-UI error message. signal.aborted guards the Back
        // button: an abort mid-stream means the user dismissed the draft, so
        // we must not yank them into the just-pinned thread (the row still
        // appears in the list after the refetch — consistent with dismiss).
        if (
          newDiscussionId &&
          !errored &&
          !pinnedRef.current &&
          !controller.signal.aborted
        ) {
          pinnedRef.current = true;
          onPinned(newDiscussionId);
        }
      }
    })();

    return () => controller.abort();
  }, [question]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-1 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-4">
        {/* Header — mirrors DiscussionDetail's shelf branch (Library icon +
            "Your bookshelf"), consistent with Hotfix A's shelf treatment. */}
        <div className="mb-4 flex gap-3">
          <div className="flex h-16 w-12 items-center justify-center rounded bg-muted text-muted-foreground">
            <Library className="h-6 w-6" />
          </div>
          <div className="min-w-0 self-center">
            <h2 className="font-serif text-lg font-medium text-espresso">Your bookshelf</h2>
          </div>
        </div>

        <div className="space-y-3">
          {localMessages.map((m, i) => (
            <MessageBubble
              key={i}
              role={m.role}
              content={m.content}
              streaming={
                streaming &&
                i === localMessages.length - 1 &&
                m.role === "assistant"
              }
            />
          ))}
        </div>

        {/* ponytail: surface stream errors in-UI (do NOT call onPinned on
            error — the user stays on the draft so the partial bubble + the
            error message persist for retry via Back). */}
        {streamError && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {streamError}
          </div>
        )}
      </div>
    </div>
  );
}

// ponytail: minimal DiscussionListItem for the missing-row race after a shelf
// pin. Book-less (type:"shelf") so DiscussionDetail's shelf branch renders and
// its ["discussion", id] GET fires to load the full persisted thread. Satisfies
// the type without lying — every field the detail reads is correct for a shelf.
function shelfDiscussionStub(id: string): DiscussionListItem {
  const nowIso = new Date().toISOString();
  return {
    id,
    type: "shelf",
    passageText: null,
    passageCfi: null,
    sectionHref: null,
    language: "en",
    createdAt: nowIso,
    updatedAt: nowIso,
    attachments: [],
    explainer: null,
    _count: { messages: 0 },
  };
}

// ─── Sub-components (same file, ponytail) ──────────────────────────────────

function DiscussionList({
  discussions,
  onSelect,
  navigate,
  resolveLabel,
}: {
  discussions: DiscussionListItem[];
  onSelect: (id: string) => void;
  navigate: NavigateFn;
  resolveLabel: (bookId: string, href: string) => string | undefined;
}) {
  return (
    <div className="px-1 pb-6">
      <ul className="space-y-2">
        {discussions.map((d) => (
          <li key={d.id}>
            <DiscussionRow
              discussion={d}
              onSelect={() => onSelect(d.id)}
              navigate={navigate}
              resolveLabel={resolveLabel}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiscussionRow({
  discussion: d,
  onSelect,
  navigate,
  resolveLabel,
}: {
  discussion: DiscussionListItem;
  onSelect: () => void;
  navigate: NavigateFn;
  resolveLabel: (bookId: string, href: string) => string | undefined;
}) {
  // ponytail: split attachments by slice. Section attachments are implicitly
  // from the origin book (the schema has no bookId on section rows). Book
  // attachments carry their own bookId + book.
  const attachedBooks = d.attachments.filter(
    (a) => a.type === "book" && a.bookId && a.book
  );
  const attachedSections = d.attachments.filter(
    (a) => a.type === "section" && a.sectionHref
  );
  // ponytail: the discussion's primary section (type=section) is also a
  // navigation affordance — shown alongside attachments. Null for passage/book.
  const primarySection = d.type === "section" && d.sectionHref ? d.sectionHref : null;

  // ponytail: dual-ownership — when a second book is attached, BOTH covers
  // render and the title becomes "Two books: T1 + T2". The 2nd book is NOT
  // shown as an attachment chip (it's a co-owner, represented by its cover).
  const isMulti = attachedBooks.length > 0;
  // ponytail: shelf discussions are book-less; use a fixed title (the list
  // payload doesn't include the opening message — see decision #2; refine
  // in Plan 3 when list view carries the first user message).
  const isShelf = d.type === "shelf";
  const involvedTitles = [d.book?.title, ...attachedBooks.map((a) => a.book!.title)].filter(
    (t): t is string => !!t
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        // ponytail: ignore keyboard that originates on a child chip — let the
        // chip's own button semantics handle it.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="group flex cursor-pointer gap-3 rounded-xl border border-line bg-white p-3 text-left transition-colors hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-serif text-base font-medium text-espresso">
          {isShelf
            ? "Ask your bookshelf"
            : isMulti
              ? booksLabel(involvedTitles)
              : d.book?.title ?? "Untitled"}
        </h3>
        <ContextChips
          discussion={d}
          attachedSections={attachedSections}
          primarySection={primarySection}
          navigate={navigate}
          resolveLabel={resolveLabel}
        />
        <span className="mt-1.5 block text-xs text-muted-foreground">
          Last message {formatRelative(d.updatedAt)} ago
        </span>
      </div>
      {/* ponytail: covers on the right so all rows share a left detail scanline
          regardless of 1 vs 2 books (single source of width variance). */}
      <div className={"flex shrink-0" + (isMulti ? " gap-1" : "")}>
        {isShelf ? (
          <div className="flex h-14 w-10 items-center justify-center rounded bg-muted text-muted-foreground">
            <Library className="h-5 w-5" />
          </div>
        ) : (
          <>
            <BookCover
              coverPath={d.book?.coverPath}
              title={d.book?.title ?? ""}
              className="h-14 w-10 rounded"
              cover
            />
            {attachedBooks.map((a) => (
              <BookCover
                key={a.id}
                coverPath={a.book!.coverPath}
                title={a.book!.title}
                className="h-14 w-10 rounded"
                cover
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ponytail: shared chip row — used in the list row. All chips stopPropagation
// on click so the parent row's onSelect doesn't fire. Each chip routes via
// `navigate`. Books are NOT chips here — dual-ownership books render as covers
// in the row; this row carries only the type indicator + section pills.
function ContextChips({
  discussion: d,
  attachedSections,
  primarySection,
  navigate,
  resolveLabel,
}: {
  discussion: DiscussionListItem;
  attachedSections: DiscussionListItem["attachments"];
  primarySection: string | null;
  navigate: NavigateFn;
  resolveLabel: (bookId: string, href: string) => string | undefined;
}) {
  const hasAny = attachedSections.length > 0 || primarySection;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {/* type chip — not clickable */}
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
        {d.type === "passage" && <Quote className="h-3 w-3" />}
        {d.type === "section" && <FileText className="h-3 w-3" />}
        {d.type === "book" && <BookOpen className="h-3 w-3" />}
        {d.type === "shelf" && <Library className="h-3 w-3" />}
        {d.type}
      </span>
      {d._count.messages > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {d._count.messages} msg
        </span>
      )}
      {hasAny && <span className="mx-1 text-muted-foreground/40">·</span>}
      {/* primary section (the discussion's own type=section context) */}
      {primarySection && (
        <SectionPill
          label={resolveLabel(d.book!.id, primarySection) ?? hrefBasename(primarySection)}
          onClick={(e) => {
            e.stopPropagation();
            navigate(d.book!.id, { href: primarySection, discussionId: d.id });
          }}
        />
      )}
      {/* attached sections */}
      {attachedSections.map((s) => (
        <SectionPill
          key={s.id}
          label={
            (s.sectionHref && resolveLabel(d.book!.id, s.sectionHref)) ||
            (s.sectionHref && hrefBasename(s.sectionHref)) ||
            ""
          }
          onClick={(e) => {
            e.stopPropagation();
            if (s.sectionHref) {
              navigate(d.book!.id, { href: s.sectionHref, discussionId: d.id });
            }
          }}
        />
      ))}
    </div>
  );
}

function SectionPill({ label, onClick }: { label: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[10px] text-foreground transition-colors hover:bg-muted"
      title={label}
    >
      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  );
}

// ─── Detail view ──────────────────────────────────────────────────────────

export function DiscussionDetail({
  discussion: d,
  onBack,
  navigate,
  resolveLabel,
  books = [],
}: {
  discussion: DiscussionListItem;
  onBack: () => void;
  navigate: NavigateFn;
  resolveLabel: (bookId: string, href: string) => string | undefined;
  books?: LibraryBook[];
}) {
  const queryClient = useQueryClient();

  // ponytail: the list row carries the explainer preview; the full message
  // thread comes from GET /api/discussions/<id>. The response now also carries
  // attachBookMax (per-tier cap) so the composer can gate the Other-book
  // picker without a second round-trip.
  const { data, isLoading } = useQuery({
    queryKey: ["discussion", d.id],
    queryFn: async () => {
      const res = await fetch(`/api/discussions/${d.id}`);
      if (!res.ok) throw new Error("Failed to load discussion");
      return (await res.json()) as {
        discussion: {
          messages?: { role: string; content: string; createdAt: string }[];
          explainer?: { content: string } | null;
          attachments?: {
            type: string;
            sectionHref: string | null;
            bookId: string | null;
            book?: { id: string; title: string; author: string | null; coverPath: string | null; txtTokens: number | null } | null;
          }[];
        } | null;
        attachBookMax?: number;
      };
    },
  });

  const explainerContent =
    data?.discussion?.explainer?.content ?? d.explainer?.content ?? "";

  // ponytail: localMessages is the render source. Populated from server truth
  // on load + on every refetch (sync effect below), and appended to during a
  // send (optimistic user msg + streaming assistant bubble). The sync effect
  // replaces local state wholesale when the server lands — same pattern as
  // discussions-panel.tsx:297-309, which is the proven handling for the
  // race between in-flight stream and background refetch.
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const msgs = data?.discussion?.messages;
    if (msgs) {
      setLocalMessages(
        msgs
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content, createdAt: m.createdAt }))
      );
    }
  }, [data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ─── Composer state ────────────────────────────────────────────────────
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ponytail: attachment state machine — ported (trimmed) from
  // discussions-panel.tsx:242-256, 1000-1184. draft = picked but unsent (x to
  // remove); pending = sent, awaiting the refetch that confirms it persisted
  // (no x); persisted = server truth. Sections + a single other-book slot.
  const [draftAttachments, setDraftAttachments] = useState<
    { type: "section"; sectionHref: string; label: string }[]
  >([]);
  const [pendingAttachments, setPendingAttachments] = useState<
    { type: "section"; sectionHref: string; label: string }[]
  >([]);
  const [draftBook, setDraftBook] = useState<{
    bookId: string;
    title: string;
    author: string | null;
    coverPath: string | null;
    txtTokens: number | null;
  } | null>(null);
  const [pendingBook, setPendingBook] = useState<{
    bookId: string;
    title: string;
    author: string | null;
    coverPath: string | null;
    txtTokens: number | null;
  } | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachView, setAttachView] = useState<"menu" | "section" | "book">("menu");

  const attachBookMax = data?.attachBookMax ?? 0;
  const bookEnabled = attachBookMax >= 1;

  // ponytail: section picker options from the origin book's tocJson. Walks the
  // flat {title, href, subitems?} tree (same shape the list-view resolveLabel
  // walker uses above). First-occurrence wins per basename.
  const sectionOptions = useMemo(() => {
    const out: { href: string; label: string }[] = [];
    // ponytail: sections are origin-book-scoped; a shelf discussion (book-less)
    // has no ToC to pick from → empty options, picker stays disabled.
    if (!d.book || !d.book.tocJson) return out;
    let toc: TocItem[];
    try {
      toc = JSON.parse(d.book.tocJson);
    } catch {
      return out;
    }
    if (!Array.isArray(toc)) return out;
    const seen = new Set<string>();
    const walk = (items: TocItem[]) => {
      for (const item of items) {
        const base = hrefBasename(item.href ?? "");
        const label = (item.title ?? item.label ?? "").trim();
        if (base && label && !seen.has(base)) {
          seen.add(base);
          out.push({ href: base, label });
        }
        if (Array.isArray(item.subitems)) walk(item.subitems);
      }
    };
    walk(toc);
    return out;
  }, [d.book?.tocJson]);

  // ponytail: permanently-attached sections (server-side). Labels resolved via
  // resolveLabel; fall back to raw href.
  const persistedAttachments: { type: "section"; sectionHref: string; label: string }[] = useMemo(() => {
    const atts = data?.discussion?.attachments ?? [];
    return atts
      .filter((a) => a.type === "section" && a.sectionHref)
      .map((a) => ({
        type: "section" as const,
        sectionHref: a.sectionHref as string,
        label: resolveLabel(d.book?.id ?? "", a.sectionHref as string) ?? hrefBasename(a.sectionHref as string),
      }));
  }, [data, d.book?.id, resolveLabel]);

  // ponytail: pending = sent-but-not-yet-confirmed; dedup against persisted so
  // a chip never renders twice during the handoff window.
  const pendingDisplay = pendingAttachments.filter(
    (p) => !persistedAttachments.some((a) => a.sectionHref === p.sectionHref)
  );

  // ponytail: permanently-attached other book (server-side, single slot).
  const persistedBook = useMemo(() => {
    const atts = data?.discussion?.attachments ?? [];
    const bookAtt = atts.find((a) => a.type === "book" && a.bookId && a.book);
    if (!bookAtt || !bookAtt.book) return null;
    return {
      bookId: bookAtt.book.id,
      title: bookAtt.book.title,
      author: bookAtt.book.author,
      coverPath: bookAtt.book.coverPath,
      txtTokens: bookAtt.book.txtTokens,
    };
  }, [data]);

  // ponytail: citation deep-link plumbing — mirrors discussions-panel.tsx:575-614.
  // Origin book's hrefs validate unprefixed #ch: citations; attached books'
  // hrefs validate prefixed #ch:<bookId>:<basename> cross-book citations.
  // Sourced from the list item's tocJson (already fetched for resolveLabel).
  const { originBookHrefs, attachedBookHrefs } = useMemo(() => {
    const parseHrefs = (tocJson: string | null | undefined): string[] => {
      if (!tocJson) return [];
      try {
        const toc = JSON.parse(tocJson) as Array<{ href?: string }>;
        return toc
          .map((t) => hrefBasename(t.href ?? ""))
          .filter((h) => h.length > 0);
      } catch {
        return [];
      }
    };
    const map: Record<string, string[]> = {};
    for (const a of d.attachments) {
      if (a.type !== "book" || !a.bookId || !a.book) continue;
      const hrefs = parseHrefs(a.book.tocJson);
      if (hrefs.length > 0) map[a.book.id] = hrefs;
    }
    return {
      originBookHrefs: d.book ? parseHrefs(d.book.tocJson) : [],
      attachedBookHrefs: Object.keys(map).length > 0 ? map : undefined,
    };
  }, [d]);

  // ponytail: route citation clicks through the SAME pendingReaderNav deep-link
  // the chips use. On arrival the reader resolves the basename to its spine
  // href (reader-client.tsx:608) and opens the sidebar to this thread.
  // ponytail: no-op for shelf discussions — shelf answers cite across the
  // library; within-book href navigation doesn't apply (no origin book).
  const onNavigateToHref = (href: string) => {
    if (!d.book) return;
    navigate(d.book.id, { href, discussionId: d.id });
  };
  const onNavigateToBookSection = (bookId: string, basename: string) =>
    navigate(bookId, { href: basename, discussionId: d.id });

  const pendingBookDisplay =
    pendingBook && persistedBook?.bookId !== pendingBook.bookId ? pendingBook : null;

  // Hrefs already in the context row (draft + pending + persisted) — excluded
  // from the picker so the user can't attach a duplicate.
  const attachedHrefs = new Set<string>([
    ...draftAttachments.map((a) => a.sectionHref),
    ...pendingDisplay.map((a) => a.sectionHref),
    ...persistedAttachments.map((a) => a.sectionHref),
  ]);
  const pickerOptions = sectionOptions.filter((s) => !attachedHrefs.has(s.href));

  // Slots remaining for attaching other books (0..max).
  const bookSlotsRemaining = Math.max(
    0,
    attachBookMax -
      (persistedBook ? 1 : 0) -
      (draftBook ? 1 : 0) -
      (pendingBookDisplay ? 1 : 0)
  );

  // ponytail: retire pending → persisted once the refetch confirms them.
  // Mirrors discussions-panel.tsx:1152-1176.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (pendingAttachments.length === 0) return;
    const confirmed = new Set(persistedAttachments.map((a) => a.sectionHref));
    setPendingAttachments((prev) => prev.filter((p) => !confirmed.has(p.sectionHref)));
  }, [persistedAttachments]);
  useEffect(() => {
    if (!pendingBook) return;
    if (persistedBook?.bookId === pendingBook.bookId) setPendingBook(null);
  }, [persistedBook]);

  // ponytail: clear drafts when switching discussions so stale picks don't
  // bleed across detail views.
  useEffect(() => {
    setDraftAttachments([]);
    setDraftBook(null);
    setPendingAttachments([]);
    setPendingBook(null);
  }, [d.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function addDraftAttachment(href: string, label: string) {
    if (attachedHrefs.has(href)) return;
    setDraftAttachments((prev) => [...prev, { type: "section", sectionHref: href, label }]);
  }
  function removeDraftAttachment(href: string) {
    setDraftAttachments((prev) => prev.filter((a) => a.sectionHref !== href));
  }
  function addDraftBook(b: { bookId: string; title: string; author: string | null; coverPath: string | null; txtTokens: number | null }) {
    if (bookSlotsRemaining <= 0) return;
    setDraftBook(b);
  }

  // ponytail: sendFollowup adapted from discussions-panel.tsx:619-742, extended
  // with the attachments payload (the POST endpoint already supports it).
  // Index-based streaming update is mandatory: object-reference equality
  // breaks after the first chunk (lesson from playground/page.tsx).
  async function sendFollowup() {
    const text = input.trim();
    if (!text || streaming) return;

    const assistantIndex = localMessages.length + 1;
    const nowIso = new Date().toISOString();
    setLocalMessages([
      ...localMessages,
      { role: "user", content: text, createdAt: nowIso },
      { role: "assistant", content: "", createdAt: nowIso },
    ]);
    setInput("");
    setStreaming(true);

    // ponytail: snapshot drafts → move to pending so chips hold steady through
    // the stream; the confirm effect retires them once the refetch lands them
    // in persisted. Mirrors discussions-panel.tsx:640-658.
    const sendingAttachments = draftAttachments;
    if (sendingAttachments.length > 0) {
      setPendingAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.sectionHref));
        return [...prev, ...sendingAttachments.filter((a) => !seen.has(a.sectionHref))];
      });
      setDraftAttachments([]);
    }
    const sendingBook = draftBook;
    if (sendingBook) {
      setPendingBook(sendingBook);
      setDraftBook(null);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const sectionPayload = sendingAttachments.map((a) => ({
        type: a.type,
        sectionHref: a.sectionHref,
      }));
      const bookPayload = sendingBook ? [{ type: "book", bookId: sendingBook.bookId }] : [];
      const attachmentsPayload = [...sectionPayload, ...bookPayload];
      const res = await fetch(`/api/discussions/${d.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          attachments: attachmentsPayload.length > 0 ? attachmentsPayload : undefined,
        }),
        signal: controller.signal,
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]" || !payload) continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === "error") {
              console.error("[DiscussionsHome] follow-up failed:", parsed.error);
              // drop the optimistic user msg + empty assistant bubble
              setLocalMessages((prev) =>
                prev.filter((_, i) => i !== assistantIndex - 1 && i !== assistantIndex)
              );
              return;
            }
            if (parsed.type === "chunk" && parsed.chunk) {
              acc += parsed.chunk;
              const snapshot = acc;
              setLocalMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIndex ? { ...m, content: snapshot } : m
                )
              );
            }
          } catch {
            // skip malformed SSE line
          }
        }
      }

      // ponytail: invalidate so the persisted turn lands from server truth
      // (sync effect above resets localMessages). Both the per-discussion
      // thread and the cross-library list (for updatedAt reordering) refresh.
      queryClient.invalidateQueries({ queryKey: ["discussion", d.id] });
      queryClient.invalidateQueries({ queryKey: ["discussions-all"] });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("[DiscussionsHome] follow-up fetch failed:", err);
      } else {
        // ponytail: on abort, still sync — the server may have persisted a
        // partial turn or none. Refetch picks up truth either way.
        queryClient.invalidateQueries({ queryKey: ["discussion", d.id] });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // ponytail: Enter to send, Shift+Enter for newline. Matches the panel.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendFollowup();
    }
  }

  const attachedBooks = d.attachments.filter(
    (a) => a.type === "book" && a.bookId && a.book
  );
  const primarySection = d.type === "section" && d.sectionHref ? d.sectionHref : null;

  // ponytail: header — parent book as a large cover, exactly as before. Dual
  // ownership (a second book attached) shows BOTH covers and the "Two books:"
  // label treatment. Each cover opens its own book in the reader.
  const isShelf = !d.book;
  const isMulti = attachedBooks.length > 0;
  const involvedTitles = [d.book?.title, ...attachedBooks.map((a) => a.book!.title)].filter(
    (t): t is string => !!t
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-1 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-4">
        {/* Header.
            ponytail: shelf branch — book-less thread. Icon tile + fixed title,
            no cover/author/open-book click (shelf answers cite across the
            library, not one origin book). Upgrade path: editable shelf name +
            curated cover when shelves get identity beyond "the whole library".
            Book/section/passage path below is byte-identical to pre-shelf. */}
        {isShelf ? (
          <div className="mb-4 flex gap-3">
            <div className="flex h-16 w-12 items-center justify-center rounded bg-muted text-muted-foreground">
              <Library className="h-6 w-6" />
            </div>
            <div className="min-w-0 self-center">
              <h2 className="font-serif text-lg font-medium text-espresso">Your bookshelf</h2>
            </div>
          </div>
        ) : (
          <div className="mb-4 flex gap-3">
            <div className={"flex shrink-0" + (isMulti ? " gap-2" : "")}>
              <button
                type="button"
                onClick={() => navigate(d.book!.id, { discussionId: d.id })}
                className="rounded-lg transition-colors hover:bg-muted/40"
                title={`Open ${d.book!.title}`}
              >
                <BookCover
                  coverPath={d.book!.coverPath}
                  title={d.book!.title}
                  className="h-16 w-12 rounded"
                  cover
                />
              </button>
              {attachedBooks.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => navigate(a.book!.id, { discussionId: d.id })}
                  className="rounded-lg transition-colors hover:bg-muted/40"
                  title={`Open ${a.book!.title}`}
                >
                  <BookCover
                    coverPath={a.book!.coverPath}
                    title={a.book!.title}
                    className="h-16 w-12 rounded"
                    cover
                  />
                </button>
              ))}
            </div>
            <div className="min-w-0 self-center">
              <h2 className="font-serif text-lg font-medium text-espresso">
                {isMulti ? booksLabel(involvedTitles) : d.book!.title}
              </h2>
              {!isMulti && d.book!.author && (
                <p className="text-xs text-muted-foreground">{d.book!.author}</p>
              )}
            </div>
          </div>
        )}

        {/* Passage excerpt (display-only) */}
        {d.type === "passage" && d.passageText && (
          <blockquote className="mb-4 border-l-2 border-line pl-3 text-sm italic text-muted-foreground">
            &ldquo;{d.passageText.slice(0, 240)}{d.passageText.length > 240 ? "…" : ""}&rdquo;
          </blockquote>
        )}

        {/* Explainer */}
        {explainerContent && (
          <div className="mb-4 rounded-lg border border-border bg-muted p-3 prose prose-sm dark:prose-invert max-w-none">
            <ExplainerContent
              content={explainerContent}
              spineHrefs={originBookHrefs}
              attachedBookHrefs={attachedBookHrefs}
              onNavigateToHref={onNavigateToHref}
              onNavigateToBookSection={onNavigateToBookSection}
            />
          </div>
        )}

        {/* Messages */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {localMessages.map((m, i) => (
              <MessageBubble
                key={i}
                role={m.role}
                content={m.content}
                streaming={
                  streaming &&
                  i === localMessages.length - 1 &&
                  m.role === "assistant"
                }
                spineHrefs={originBookHrefs}
                attachedBookHrefs={attachedBookHrefs}
                onNavigateToHref={onNavigateToHref}
                onNavigateToBookSection={onNavigateToBookSection}
              />
            ))}
          </div>
        )}
      </div>

      {/* Composer — sticky at the bottom of the detail pane. */}
      <div className="shrink-0 border-t border-line p-2 flex flex-col gap-1.5">
        <ComposerContextRow
          originBook={
            d.book
              ? {
                  bookId: d.book.id,
                  title: d.book.title,
                  author: d.book.author,
                  coverPath: d.book.coverPath,
                }
              : undefined
          }
          originBookId={d.book?.id}
          primarySection={
            primarySection && d.book
              ? {
                  href: primarySection,
                  label:
                    resolveLabel(d.book.id, primarySection) ??
                    hrefBasename(primarySection),
                }
              : null
          }
          persistedAttachments={persistedAttachments}
          pendingAttachments={pendingDisplay}
          draftAttachments={draftAttachments}
          persistedBook={persistedBook}
          pendingBook={pendingBookDisplay}
          draftBook={draftBook}
          onRemoveDraftAttachment={removeDraftAttachment}
          onRemoveDraftBook={() => setDraftBook(null)}
          navigate={navigate}
          discussionId={d.id}
          pickerOptions={pickerOptions}
          onAddDraftAttachment={addDraftAttachment}
          books={books}
          bookEnabled={bookEnabled}
          bookSlotsRemaining={bookSlotsRemaining}
          onAddDraftBook={addDraftBook}
          attachOpen={attachOpen}
          setAttachOpen={setAttachOpen}
          attachView={attachView}
          setAttachView={setAttachView}
        />
        <div className="flex items-end gap-2 rounded-xl border border-line bg-white p-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a follow-up…"
            disabled={streaming}
            className="min-h-[40px] flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
            rows={1}
          />
          <Button
            type="button"
            size="icon"
            onClick={sendFollowup}
            disabled={streaming || !input.trim()}
            aria-label="Send follow-up"
            className="shrink-0"
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Composer context row + Attach Popover ─────────────────────────────────
// ponytail: ported (trimmed) from discussions-panel.tsx:1889-2216. Shows all
// context anchored to a follow-up: persisted/pending sections (no x), draft
// sections (with x), the single other-book slot (persisted/pending/draft),
// and a unified "Attach" Popover swapping between a Section Command list
// (sourced from the origin book's tocJson) and an Other-book Command list
// (sourced from the user's library). All books render as named peers — no
// "This book" singular, since multiple books can be co-equal context here.

type SectionAtt = { type: "section"; sectionHref: string; label: string };
type BookAtt = {
  bookId: string;
  title: string;
  author: string | null;
  coverPath: string | null;
  txtTokens: number | null;
};

function ComposerContextRow({
  originBook,
  originBookId,
  primarySection,
  persistedAttachments,
  pendingAttachments,
  draftAttachments,
  persistedBook,
  pendingBook,
  draftBook,
  onRemoveDraftAttachment,
  onRemoveDraftBook,
  navigate,
  discussionId,
  pickerOptions,
  onAddDraftAttachment,
  books,
  bookEnabled,
  bookSlotsRemaining,
  onAddDraftBook,
  attachOpen,
  setAttachOpen,
  attachView,
  setAttachView,
}: {
  // ponytail: originBook/originBookId optional so shelf (book-less) discussions
  // can render the composer with no seed book — follow-ups still POST normally.
  originBook?: { bookId: string; title: string; author: string | null; coverPath: string | null };
  originBookId?: string;
  primarySection: { href: string; label: string } | null;
  persistedAttachments: SectionAtt[];
  pendingAttachments: SectionAtt[];
  draftAttachments: SectionAtt[];
  persistedBook: BookAtt | null;
  pendingBook: BookAtt | null;
  draftBook: BookAtt | null;
  onRemoveDraftAttachment: (href: string) => void;
  onRemoveDraftBook: () => void;
  navigate: NavigateFn;
  discussionId: string;
  pickerOptions: { href: string; label: string }[];
  onAddDraftAttachment: (href: string, label: string) => void;
  books: LibraryBook[];
  bookEnabled: boolean;
  bookSlotsRemaining: number;
  onAddDraftBook: (b: BookAtt) => void;
  attachOpen: boolean;
  setAttachOpen: (o: boolean) => void;
  attachView: "menu" | "section" | "book";
  setAttachView: (v: "menu" | "section" | "book") => void;
}) {
  const sectionAvailable = pickerOptions.length > 0;
  const booksAvailable = bookEnabled && bookSlotsRemaining > 0;

  const closeAttach = () => {
    setAttachOpen(false);
    setAttachView("menu");
  };

  const renderBookChip = (
    b: BookAtt,
    key: string,
    onRemove?: () => void,
    onClick?: () => void
  ) => (
    <span
      key={key}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={
        onClick
          ? "inline-flex max-w-[14rem] cursor-pointer items-center gap-1 truncate rounded bg-muted px-1.5 py-0.5 underline-offset-2 hover:underline"
          : "inline-flex max-w-[14rem] items-center gap-1 truncate rounded bg-muted px-1.5 py-0.5"
      }
      title={`${b.title}${b.author ? ` — ${b.author}` : ""}`}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <span className="h-4 w-3 shrink-0 overflow-hidden rounded-sm">
        <BookCover coverPath={b.coverPath} title={b.title} cover />
      </span>
      <span className="truncate text-xs">{b.title}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${b.title}`}
          onClick={onRemove}
          className="text-muted-foreground/70 hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
      <span className="font-medium uppercase tracking-wide">Context</span>
      {/* origin book — always present (always sent with every follow-up).
           Clickable → reader. No x: it's the discussion's seed book.
           Omitted for shelf discussions (no origin book). */}
      {originBook &&
        renderBookChip(
          { ...originBook, txtTokens: null },
          `ob-${originBook.bookId}`,
          undefined,
          () => navigate(originBook.bookId, { discussionId })
        )}
      {/* primary section — the discussion's own type=section context (the
           section it was started from). Clickable → reader. No x. */}
      {primarySection && originBookId && (
        <button
          key={`ps-${primarySection.href}`}
          type="button"
          className="max-w-[12rem] truncate rounded bg-muted px-1.5 py-0.5 underline-offset-2 hover:underline"
          title={primarySection.label}
          onClick={() => navigate(originBookId, { href: primarySection.href, discussionId })}
        >
          {primarySection.label}
        </button>
      )}
      {/* persisted sections (no x — re-sent every follow-up) */}
      {persistedAttachments.map((a) => (
        <button
          key={`p-${a.sectionHref}`}
          type="button"
          className="max-w-[12rem] truncate rounded bg-muted px-1.5 py-0.5 underline-offset-2 hover:underline"
          title={a.label}
          onClick={() => originBookId && navigate(originBookId, { href: a.sectionHref, discussionId })}
        >
          {a.label}
        </button>
      ))}
      {/* pending sections (sent, awaiting confirm — no x) */}
      {pendingAttachments.map((a) => (
        <button
          key={`k-${a.sectionHref}`}
          type="button"
          className="max-w-[12rem] truncate rounded bg-muted px-1.5 py-0.5 underline-offset-2 hover:underline"
          title={a.label}
          onClick={() => originBookId && navigate(originBookId, { href: a.sectionHref, discussionId })}
        >
          {a.label}
        </button>
      ))}
      {/* draft sections (picked, unsent — removable via x) */}
      {draftAttachments.map((a) => (
        <span
          key={`d-${a.sectionHref}`}
          className="inline-flex max-w-[12rem] items-center gap-0.5 truncate rounded bg-muted px-1.5 py-0.5"
          title={a.label}
        >
          <span className="truncate">{a.label}</span>
          <button
            type="button"
            aria-label={`Remove ${a.label}`}
            onClick={() => onRemoveDraftAttachment(a.sectionHref)}
            className="text-muted-foreground/70 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {/* book chips: persisted + pending (clickable → reader) + draft (removable) */}
      {persistedBook &&
        renderBookChip(
          persistedBook,
          `pb-${persistedBook.bookId}`,
          undefined,
          () => navigate(persistedBook.bookId, { discussionId })
        )}
      {pendingBook &&
        pendingBook.bookId !== persistedBook?.bookId &&
        renderBookChip(
          pendingBook,
          `kb-${pendingBook.bookId}`,
          undefined,
          () => navigate(pendingBook.bookId, { discussionId })
        )}
      {draftBook &&
        draftBook.bookId !== persistedBook?.bookId &&
        draftBook.bookId !== pendingBook?.bookId &&
        renderBookChip(draftBook, "db", onRemoveDraftBook)}
      {/* unified Attach affordance */}
      {(sectionAvailable || booksAvailable || attachOpen) && (
        <Popover
          open={attachOpen}
          onOpenChange={(o) => {
            if (o) {
              setAttachView(bookEnabled ? "menu" : "section");
            } else {
              setAttachView("menu");
            }
            setAttachOpen(o);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-0.5 rounded border border-dashed border-border px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={bookEnabled ? "Attach more context" : "Attach another section"}
            >
              <Plus className="h-3 w-3" />
              {bookEnabled ? "Attach" : "Section"}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            {attachView === "menu" && (
              <div className="p-1">
                <button
                  type="button"
                  disabled={!sectionAvailable}
                  onClick={() => setAttachView("section")}
                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                >
                  Section from this book…
                </button>
                <button
                  type="button"
                  disabled={!booksAvailable}
                  onClick={() => setAttachView("book")}
                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                >
                  Other book…
                </button>
              </div>
            )}
            {attachView === "section" && (
              <Command>
                <CommandInput placeholder="Find a section…" />
                <CommandList className="max-h-60">
                  <CommandEmpty>No sections.</CommandEmpty>
                  <CommandGroup>
                    {pickerOptions.map((s) => (
                      <CommandItem
                        key={s.href}
                        value={s.label}
                        onSelect={() => {
                          onAddDraftAttachment(s.href, s.label);
                          closeAttach();
                        }}
                        className="text-xs"
                      >
                        <span className="truncate">{s.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            )}
            {attachView === "book" && (
              <Command>
                <CommandInput placeholder="Find a book…" />
                <CommandList className="max-h-72">
                  <CommandEmpty>No books.</CommandEmpty>
                  <CommandGroup>
                    {books
                      .filter((b) => b.id !== originBookId)
                      .map((b) => (
                        <CommandItem
                          key={b.id}
                          value={`${b.title} ${b.author ?? ""}`}
                          onSelect={() => {
                            onAddDraftBook({
                              bookId: b.id,
                              title: b.title,
                              author: b.author,
                              coverPath: b.coverPath,
                              txtTokens: b.txtTokens,
                            });
                            closeAttach();
                          }}
                          className="gap-2"
                        >
                          <span className="h-8 w-6 shrink-0 overflow-hidden rounded-sm">
                            <BookCover coverPath={b.coverPath} title={b.title} cover />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">
                              {b.title}
                            </span>
                            {b.author && (
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {b.author}
                              </span>
                            )}
                          </span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// ponytail: read-only message bubble. The reader-side DiscussionsPanel has
// its own (admin tools, raw toggle, citation deep-links) — too coupled to
// share. This is the minimum needed for the homepage: markdown render for
// assistant, plain text for user, plus a pulse placeholder while streaming.
function MessageBubble({
  role,
  content,
  streaming,
  spineHrefs,
  attachedBookHrefs,
  onNavigateToHref,
  onNavigateToBookSection,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  // ponytail: forwarded straight to ExplainerContent so in-message #ch:
  // citations deep-link exactly like the reader sidebar's bubbles.
  spineHrefs?: string[];
  attachedBookHrefs?: Record<string, string[]>;
  onNavigateToHref?: (href: string) => void;
  onNavigateToBookSection?: (bookId: string, basename: string) => void;
}) {
  return (
    <div
      className={
        role === "user"
          ? "flex flex-col items-end"
          : "flex flex-col items-start"
      }
    >
      <div
        className={
          role === "user"
            ? "max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
            : "max-w-[85%] rounded-lg border border-border bg-muted px-3 py-2 text-sm prose prose-sm dark:prose-invert max-w-none"
        }
      >
        {/* ponytail: empty assistant bubble mid-stream → pulse placeholder so
            the user sees the turn is in flight before any chunk lands. */}
        {role === "assistant" && !content && streaming ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
          </span>
        ) : role === "assistant" ? (
          <ExplainerContent
            content={content}
            spineHrefs={spineHrefs ?? []}
            attachedBookHrefs={attachedBookHrefs}
            onNavigateToHref={onNavigateToHref}
            onNavigateToBookSection={onNavigateToBookSection}
          />
        ) : (
          content
        )}
      </div>
    </div>
  );
}

// ponytail: 5-line relative time — matches the DiscussionsPanel's helper
// (discussions-panel.tsx:2449). Not exported there, re-inlined here.
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

// ponytail: one-line preview for the list row. Mirrors the DiscussionsPanel
// ListView fallback chain (discussions-panel.tsx:1416).
function previewText(d: DiscussionListItem): string {
  if (d.passageText) return `"${d.passageText.slice(0, 120)}${d.passageText.length > 120 ? "…" : ""}"`;
  return "Whole book";
}
