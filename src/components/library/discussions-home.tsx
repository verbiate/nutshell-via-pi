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
  Loader2,
  Send,
} from "lucide-react";
import { BookCover } from "./book-cover";
import { ExplainerContent } from "../explainer/explainer-content";
import { SmoothScrollArea } from "./smooth-scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useReaderNav } from "@/components/reader/reader-nav-context";
import { hrefBasename } from "@/lib/explainer/citations";
import type { DiscussionListItem } from "@/types/discussion";

// ponytail: in-flight message shape. createdAt is optional — synthesized
// during streaming, replaced with server truth on refetch. Mirrors the panel.
type Message = { role: "user" | "assistant"; content: string; createdAt?: string };

interface Props {
  discussions: DiscussionListItem[];
  // ponytail: switches the parent Tabs to "bookshelf" — used by the empty
  // state CTA. Optional so the component can render standalone.
  onGoToBookshelf?: () => void;
}

type NavigateFn = (
  bookId: string,
  opts: { href?: string; discussionId: string }
) => void;

export function DiscussionsHomeView({ discussions: initial, onGoToBookshelf }: Props) {
  const router = useRouter();
  const { markPendingReaderNav } = useReaderNav();
  const [activeId, setActiveId] = useState<string | null>(null);

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
    type TocItem = { href?: string; label?: string; title?: string; subitems?: TocItem[] };
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

  const active = activeId ? discussions.find((d) => d.id === activeId) : null;

  if (active) {
    // ponytail: chat-shaped — NO SmoothScrollArea wrapper. DiscussionDetail's
    // internal `flex h-full flex-col` + `flex-1 overflow-y-auto` middle needs
    // height to propagate from TabsContent (lg:absolute lg:inset-0) so the
    // composer anchors to the bottom. Wrapping in SmoothScrollArea breaks
    // that chain — the composer scrolls away with content. Mirrors the
    // reader-sidebar bulb pattern (reader-sidebar.tsx:116-126).
    return (
      <div className="h-full min-h-[60vh] lg:min-h-0">
        <DiscussionDetail
          discussion={active}
          onBack={() => setActiveId(null)}
          navigate={navigate}
          resolveLabel={resolveLabel}
        />
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
      <BookCover
        coverPath={d.book.coverPath}
        title={d.book.title}
        className="h-14 w-10 shrink-0 rounded"
        cover
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-serif text-base font-medium text-espresso">
            {d.book.title}
          </h3>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelative(d.updatedAt)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {previewText(d)}
        </p>
        <ContextChips
          discussion={d}
          attachedBooks={attachedBooks}
          attachedSections={attachedSections}
          primarySection={primarySection}
          navigate={navigate}
          resolveLabel={resolveLabel}
        />
      </div>
    </div>
  );
}

// ponytail: shared chip row — used in both the list row and the detail
// header. All chips stopPropagation on click so the parent row's onSelect
// doesn't fire. Each chip routes via `navigate`.
function ContextChips({
  discussion: d,
  attachedBooks,
  attachedSections,
  primarySection,
  navigate,
  resolveLabel,
}: {
  discussion: DiscussionListItem;
  attachedBooks: DiscussionListItem["attachments"];
  attachedSections: DiscussionListItem["attachments"];
  primarySection: string | null;
  navigate: NavigateFn;
  resolveLabel: (bookId: string, href: string) => string | undefined;
}) {
  const hasAny =
    attachedBooks.length > 0 || attachedSections.length > 0 || primarySection;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {/* type chip — not clickable */}
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
        {d.type === "passage" && <Quote className="h-3 w-3" />}
        {d.type === "section" && <FileText className="h-3 w-3" />}
        {d.type === "book" && <BookOpen className="h-3 w-3" />}
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
          label={resolveLabel(d.book.id, primarySection) ?? hrefBasename(primarySection)}
          onClick={(e) => {
            e.stopPropagation();
            navigate(d.book.id, { href: primarySection, discussionId: d.id });
          }}
        />
      )}
      {/* attached sections */}
      {attachedSections.map((s) => (
        <SectionPill
          key={s.id}
          label={
            (s.sectionHref && resolveLabel(d.book.id, s.sectionHref)) ||
            (s.sectionHref && hrefBasename(s.sectionHref)) ||
            ""
          }
          onClick={(e) => {
            e.stopPropagation();
            if (s.sectionHref) {
              navigate(d.book.id, { href: s.sectionHref, discussionId: d.id });
            }
          }}
        />
      ))}
      {/* attached books (co-primary context) */}
      {attachedBooks.map((b) => (
        <BookChip
          key={b.id}
          title={b.book?.title ?? ""}
          coverPath={b.book?.coverPath ?? null}
          onClick={(e) => {
            e.stopPropagation();
            if (b.bookId) navigate(b.bookId, { discussionId: d.id });
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

function BookChip({
  title,
  coverPath,
  onClick,
}: {
  title: string;
  coverPath: string | null;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-line bg-white px-1.5 py-0.5 text-[10px] text-foreground transition-colors hover:bg-muted"
      title={title}
    >
      <BookCover
        coverPath={coverPath}
        title={title}
        className="h-4 w-3 shrink-0 rounded-sm"
        cover
      />
      <span className="truncate">{title}</span>
    </button>
  );
}

// ─── Detail view ──────────────────────────────────────────────────────────

export function DiscussionDetail({
  discussion: d,
  onBack,
  navigate,
  resolveLabel,
}: {
  discussion: DiscussionListItem;
  onBack: () => void;
  navigate: NavigateFn;
  resolveLabel: (bookId: string, href: string) => string | undefined;
}) {
  const queryClient = useQueryClient();

  // ponytail: the list row carries the explainer preview; the full message
  // thread comes from GET /api/discussions/<id> (the existing endpoint).
  const { data, isLoading } = useQuery({
    queryKey: ["discussion", d.id],
    queryFn: async () => {
      const res = await fetch(`/api/discussions/${d.id}`);
      if (!res.ok) throw new Error("Failed to load discussion");
      return (await res.json()) as {
        discussion: {
          messages?: { role: string; content: string; createdAt: string }[];
          explainer?: { content: string } | null;
        } | null;
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

  // ponytail: sendFollowup adapted from discussions-panel.tsx:619-742.
  // Text-only — no attachment editing UI (v1). The POST endpoint already
  // exists at /api/discussions/<id>/messages. Index-based streaming update
  // is mandatory: object-reference equality breaks after the first chunk
  // (lesson from playground/page.tsx, documented in the panel).
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

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/discussions/${d.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
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
  const attachedSections = d.attachments.filter(
    (a) => a.type === "section" && a.sectionHref
  );
  const primarySection = d.type === "section" && d.sectionHref ? d.sectionHref : null;

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
        {/* Header: origin book + context chips */}
        <div className="mb-4 flex gap-3">
          <button
            type="button"
            onClick={() => navigate(d.book.id, { discussionId: d.id })}
            className="flex gap-3 rounded-lg text-left transition-colors hover:bg-muted/40"
            title={`Open ${d.book.title}`}
          >
            <BookCover
              coverPath={d.book.coverPath}
              title={d.book.title}
              className="h-16 w-12 shrink-0 rounded"
              cover
            />
            <div className="min-w-0 self-center">
              <h2 className="font-serif text-lg font-medium text-espresso">
                {d.book.title}
              </h2>
              {d.book.author && (
                <p className="text-xs text-muted-foreground">{d.book.author}</p>
              )}
            </div>
          </button>
        </div>

        {/* Context chips row */}
        <div className="mb-4">
          <ContextChips
            discussion={d}
            attachedBooks={attachedBooks}
            attachedSections={attachedSections}
            primarySection={primarySection}
            navigate={navigate}
            resolveLabel={resolveLabel}
          />
        </div>

        {/* Passage excerpt (display-only) */}
        {d.type === "passage" && d.passageText && (
          <blockquote className="mb-4 border-l-2 border-line pl-3 text-sm italic text-muted-foreground">
            &ldquo;{d.passageText.slice(0, 240)}{d.passageText.length > 240 ? "…" : ""}&rdquo;
          </blockquote>
        )}

        {/* Explainer */}
        {explainerContent && (
          <div className="mb-4 rounded-lg border border-border bg-muted p-3 prose prose-sm dark:prose-invert max-w-none">
            <ExplainerContent content={explainerContent} spineHrefs={[]} />
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
              />
            ))}
          </div>
        )}
      </div>

      {/* Composer — sticky at the bottom of the detail pane. */}
      <div className="shrink-0 border-t border-line p-2">
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

// ponytail: read-only message bubble. The reader-side DiscussionsPanel has
// its own (admin tools, raw toggle, citation deep-links) — too coupled to
// share. This is the minimum needed for the homepage: markdown render for
// assistant, plain text for user, plus a pulse placeholder while streaming.
function MessageBubble({
  role,
  content,
  streaming,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
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
          <ExplainerContent content={content} spineHrefs={[]} />
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
