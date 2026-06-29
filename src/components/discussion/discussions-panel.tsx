"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hrefBasename } from "@/lib/explainer/citations";
import { useShelfCitedHrefs } from "@/hooks/use-shelf-cited-hrefs";
import {
  mergeTimeline,
  isTurnZeroAttachment,
  type TimelineEvent,
} from "@/lib/discussion/timeline";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Send,
  Lightbulb,
  Loader2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Trash2,
  Database,
  RefreshCw,
  Code,
  Copy,
  Check,
  Plus,
  X,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SmoothScrollArea } from "@/components/library/smooth-scroll-area";
import { useSession } from "@/hooks/use-session";
import {
  countTokens,
  formatTokens,
  EXPLAINER_TEMPLATE_TOKENS,
} from "@/lib/client-tokens";
import type { SpineItem } from "@/lib/reader/spine-playlist";
import { ExplainerContent } from "../explainer/explainer-content";
import { BookCover } from "../library/book-cover";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScrollerScrollable,
} from "@/components/ui/message-scroller";

// ponytail: single-file panel for the sidebar's `bulb` tool. Two views
// (list / discussion) gated by `activeDiscussionId`. Receives `pendingPassage` from
// the parent reader-client when the user clicks "Explain this" — fires the
// create-discussion API and streams the initial response into a fresh discussion view.
//
// No zustand — follows codebase convention of React Query + local state.
// Streaming uses index-based message updates (lesson from playground/page.tsx:
// never compare streaming placeholders by object reference).

type DiscussionType = "passage" | "section" | "book";

type DiscussionPreview = {
  id: string;
  type: DiscussionType;
  passageText: string | null;
  sectionHref: string | null;
  language: string;
  updatedAt: string;
  explainer?: { id: string; content: string; modelId: string };
  _count: { messages: number };
  // ponytail: origin book display fields. Included by the union list query so
  // cross-listed rows (attached from another book) can show a hint. Null when
  // the book relation wasn't selected (older callers).
  book?: { id: string; title: string; coverPath: string | null } | null;
};

// ponytail: createdAt is optional — present once the server round-trip lands,
// missing on locally-streamed turns (sendFollowup/sendDraftMessage synthesize
// it). mergeTimeline uses it to place attachment-event markers; missing => tail.
type Message = { role: "user" | "assistant"; content: string; createdAt?: string };

// ponytail: an attached "other book" chip. Single-slot (the per-tier cap is
// usually 1) so it's a nullable object, not an array like sections. Carries
// just enough for the chip + picker row; the server stores only bookId.
type BookAttachment = {
  bookId: string;
  title: string;
  author: string | null;
  coverPath: string | null;
  // ponytail: cached token count of the book's full plaintext — feeds the
  // "X% full" indicator so the cost of attaching shows before sending.
  txtTokens: number | null;
};

// ponytail: discriminated union — one state slot for any kind of pending
// explainer request (passage/section/book). Reader-client sets it, this
// panel consumes it, parent clears it via onConsumed.
export type PendingDiscussionRequest =
  | { type: "passage"; text: string; cfi: string | null }
  | { type: "section"; sectionHref: string; sectionTitle: string }
  | { type: "book" };

export interface DiscussionsPanelProps {
  bookId: string;
  pendingRequest: PendingDiscussionRequest | null;
  onConsumed: () => void;
  // ponytail: cross-book deep-link arrival. When set, the panel auto-selects
  // this discussion on mount (used by reader-client's pending-nav consumption
  // effect after navigating to a co-primary book). Cleared via the callback.
  pendingOpenDiscussionId?: string | null;
  onPendingDiscussionConsumed?: () => void;
  // ponytail: fired when the panel pops a discussion into the modal so the parent
  // can close the sidebar (gives the modal full focus). The bulb panel stays
  // mounted via reader-sidebar.tsx's lastTool pattern, so panel state
  // (activeDiscussionId, streaming, poppedOut) is preserved while hidden.
  onCloseSidebar?: () => void;
  // ponytail: fired when the user "returns" the discussion from the modal
  // back to the sidebar. Parent reopens the bulb tool; the panel was never
  // unmounted (lastTool), so the active discussion is still intact.
  onReturnToSidebar?: () => void;
  // ponytail: token-budget inputs for the "X% full" indicator. Both come from
  // the reader server component (resolved via tier config + getContextWindow).
  // Optional so the panel doesn't crash if a future caller omits them — the
  // bar simply doesn't render.
  bookTxtTokens?: number | null;
  contextWindow?: number;
  // ponytail: citation deep-link plumbing. spineItems is the reader's spine
  // (used to validate hrefs by basename + provided to DiscussionView/MessageBubble);
  // onNavigateToHref reuses the reader's existing ToC navigation path.
  onNavigateToHref?: (href: string) => void;
  // ponytail: CFI-precise deeplink for the discussion's originating passage
  // (mirrors highlights). Falls back to section-level nav when no CFI.
  onNavigateToCfi?: (cfi: string) => void;
  // ponytail: cross-book deep-link nav. Fired when the user clicks a
  // #ch:<bookId>:<basename> citation targeting an ATTACHED book. The handler
  // (in reader-client) closes the sidebar, marks a pending nav, and router-
  // pushes to the target book; on arrival the reader opens at the cited
  // section with this discussion open in the Discussions panel.
  // discussionId is injected by the panel's wrapper (navigateBookAndCloseModal)
  // from its activeDiscussionId state — inner components (DiscussionView,
  // MessageBubble, ExplainerContent) pass only (bookId, basename).
  onNavigateToBookSection?: (bookId: string, basename: string, discussionId?: string) => void;
  // ponytail: open a book to its last-read position + reopen the discussion.
  // Chip click → pending nav with discussionId (no href) → reader restores
  // saved position, Discussions panel opens to the thread on arrival.
  onOpenBook?: (bookId: string, discussionId?: string) => void;
  // ponytail: resolve a section href to its ToC label, for discussions reopened
  // after the click-time title is gone (the title isn't persisted server-side).
  resolveSectionLabel?: (href: string) => string | undefined;
  spineItems?: SpineItem[];
  // ponytail: picker source for "Add section" attachments. Flat ToC in spine
  // reading order ({href,label}[]). Built by reader-client from the same
  // buildSpinePlaylist it already computes; passed down so the composer can
  // offer additional sections as permanent discussion context.
  sectionOptions?: { href: string; label: string }[];
  // ponytail: per-tier cap on how many OTHER books can be attached. 0 = the
  // "+ book" affordance is hidden entirely (the unified attach button degrades
  // to the plain section picker). Resolved reader-side from the admin setting.
  attachBookMax?: number;
}

// ponytail:reports the MessageScroller viewport's "at bottom" state up to
// DiscussionView, which uses it to gate auto-follow during follow-up streams:
// when streaming a reply, the viewport pins to the user's anchored question and
// only resumes live-edge following once the reader scrolls back to the bottom
// (the manual "latch back on"). `end` is the primitive's "scrollable distance
// remaining > threshold" flag (true = NOT at bottom), so we invert it to
// `latched = !end`. The hook + this component must live INSIDE
// MessageScrollerProvider (context boundary), which is why it's a separate
// renderless child rather than a call inside DiscussionView itself.
function ScrollLatch({ onChange }: { onChange: (latchedAtBottom: boolean) => void }) {
  const { end } = useMessageScrollerScrollable();
  useEffect(() => {
    onChange(!end);
  }, [end, onChange]);
  return null;
}

export function DiscussionsPanel({
  bookId,
  pendingRequest,
  onConsumed,
  pendingOpenDiscussionId,
  onPendingDiscussionConsumed,
  onCloseSidebar,
  onReturnToSidebar,
  bookTxtTokens,
  contextWindow,
  onNavigateToHref,
  onNavigateToCfi,
  onNavigateToBookSection,
  onOpenBook,
  resolveSectionLabel,
  spineItems,
  sectionOptions,
  attachBookMax,
}: DiscussionsPanelProps) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const isAdmin = ((user as any)?.role as string) === "admin";
  const [activeDiscussionId, setActiveDiscussionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [discussionToPurge, setDiscussionToPurge] = useState<DiscussionPreview | null>(null);
  // ponytail: pop-out modal state. When true, the same panel view (discussion or
  // list) renders inside a Dialog at max-w-2xl h-[80vh] for "elbow room".
  // Sidebar keeps rendering behind the dimmed/blurred overlay (Radix blocks
  // pointer events), so closing the modal returns focus with state intact.
  const [poppedOut, setPoppedOut] = useState(false);
  // ponytail: admin re-reroll streaming state. Reroll generates a NEW explainer
  // version; the admin watches it stream, then sees "v{N} now live". Their own
  // discussion stays pinned to its version (per the versioning rule).
  const [rerolling, setRerolling] = useState(false);
  const [rerollContent, setRerollContent] = useState("");
  const [rerollPhase, setRerollPhase] = useState<"explaining" | "refining" | null>(null);
  const [rerollResult, setRerollResult] = useState<number | null>(null);
  // ponytail: draft mode for "New discussion" — the button opens an empty
  // composer WITHOUT firing an explainer request. The discussion row is only
  // created (server-side) when the user sends their opening question, which the
  // book answers with full-book context. Lets a user start fresh from their own
  // question instead of a generated explainer.
  const [drafting, setDrafting] = useState(false);
  // ponytail: click-time context captured so the Context chips render
  // IMMEDIATELY (during generation), before the server discussion row loads. Holds
  // the section's ToC title too — which isn't persisted server-side. Cleared
  // on back/list-select so a reopened discussion falls back to activeDiscussion +
  // resolveSectionLabel.
  const [localContext, setLocalContext] = useState<{
    type: DiscussionType;
    passageText: string | null;
    passageCfi: string | null;
    sectionHref: string | null;
    sectionTitle: string | null;
  } | null>(null);
  // ponytail: sections the user has picked via "Add section" but not yet sent.
  // Removable (x) until the next follow-up POST, at which point they're
  // persisted server-side and become permanent (no x). Cleared on view change.
  const [draftAttachments, setDraftAttachments] = useState<
    { type: "section"; sectionHref: string; label: string }[]
  >([]);
  // ponytail: attachments just sent, awaiting the active-discussion refetch
  // that confirms them as persisted. Rendered WITHOUT an x (they're committed);
  // cleared by the confirm effect once persistedAttachments catches up. Bridges
  // the gap between send and refetch-resolve so the chip never disappears.
  const [pendingAttachments, setPendingAttachments] = useState<
    { type: "section"; sectionHref: string; label: string }[]
  >([]);
  // ponytail: attached "other book" — single-slot (per-tier cap, usually 1).
  // Same draft→pending→persisted lifecycle as section attachments. Persisted is
  // derived from activeData (see persistedBook below); draft/pending live here.
  const [draftBook, setDraftBook] = useState<BookAttachment | null>(null);
  const [pendingBook, setPendingBook] = useState<BookAttachment | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // ponytail: StrictMode double-fire guard for the pendingRequest effect below.
  // Holds the last-processed request reference; the effect bails if the
  // incoming request matches (same reference = same render's StrictMode re-fire).
  const lastProcessedRef = useRef<PendingDiscussionRequest | null>(null);

  // List of discussions for this book (sidebar list view)
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ["discussions", bookId],
    queryFn: async () => {
      const res = await fetch(`/api/discussions?bookId=${bookId}`);
      if (!res.ok) throw new Error("Failed to load discussions");
      return res.json();
    },
  });
  const discussions: DiscussionPreview[] = listData?.discussions ?? [];

  // Active discussion content + messages
  const { data: activeData } = useQuery({
    queryKey: ["discussion", activeDiscussionId],
    queryFn: async () => {
      const res = await fetch(`/api/discussions/${activeDiscussionId}`);
      if (!res.ok) throw new Error("Failed to load discussion");
      return res.json();
    },
    enabled: !!activeDiscussionId,
  });

  // Local copy of messages so we can stream chunks into the last assistant
  // message without re-fetching.
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [initialContent, setInitialContent] = useState<string>("");
  const [streamingInitial, setStreamingInitial] = useState(false);
  // ponytail: two-pass progress phase (null for one-pass / after completion).
  // Drives a "Explaining…" / "Refining…" label during pass 1's silent window.
  const [phase, setPhase] = useState<"explaining" | "refining" | null>(null);

  // ponytail: when activeDiscussionId changes (or active data loads), reset local
  // state from server truth. This is the only place setState is called in an
  // effect intentionally — we want to sync from server when the discussion changes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (activeData?.discussion) {
      // explainer is optional (blank "New discussion" discussions have no seed).
      setInitialContent(activeData.discussion.explainer?.content ?? "");
      setLocalMessages(
        activeData.discussion.messages
          ?.filter((m: any) => m.role === "user" || m.role === "assistant")
          .map((m: any) => ({ role: m.role, content: m.content, createdAt: m.createdAt })) ?? []
      );
    }
  }, [activeData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Handle a new pending passage from the parent (user clicked "Explain this")
  // ponytail: defined after startPassageDiscussion below to satisfy declaration order.
  // (See effect placement at bottom of this section.)

  const startDiscussion = useCallback(
    async (request: PendingDiscussionRequest) => {
      // Reset state for the new discussion
      setActiveDiscussionId(null);
      setInitialContent("");
      setLocalMessages([]);
      setStreamingInitial(true);
      setStreaming(true);
      setPhase(null);
      setLocalContext({
        type: request.type,
        passageText: request.type === "passage" ? request.text : null,
        passageCfi: request.type === "passage" ? request.cfi : null,
        sectionHref: request.type === "section" ? request.sectionHref : null,
        sectionTitle: request.type === "section" ? request.sectionTitle : null,
      });

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = "";
      let newDiscussionId: string | null = null;

      // Build POST body from the discriminated union
      const body: Record<string, unknown> = { bookId, type: request.type };
      if (request.type === "passage") {
        body.passageText = request.text;
        body.passageCfi = request.cfi;
      } else if (request.type === "section") {
        body.sectionHref = request.sectionHref;
      }

      try {
        const res = await fetch("/api/discussions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.body) {
          setStreamingInitial(false);
          setStreaming(false);
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
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            if (!data) continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "error") {
                console.error("Discussion creation failed:", parsed.error);
                setStreamingInitial(false);
                setStreaming(false);
                setPhase(null);
                return;
              }
              if (parsed.type === "status" && parsed.stage) {
                setPhase(parsed.stage as "explaining" | "refining");
              }
              if (parsed.type === "existing" && parsed.discussionId) {
                // ponytail: user already has a discussion for this context —
                // reopen it instead of regenerating. Just navigate; the active-
                // discussion query loads its content.
                newDiscussionId = parsed.discussionId;
                break;
              }
              if (parsed.type === "chunk" && parsed.chunk) {
                accumulated += parsed.chunk;
                setInitialContent(accumulated);
              }
              if (parsed.type === "discussion" && parsed.discussionId) {
                newDiscussionId = parsed.discussionId;
              }
            } catch {
              // Skip malformed lines
            }
          }
        }

        // Invalidate the list so the new discussion appears
        queryClient.invalidateQueries({ queryKey: ["discussions", bookId] });

        // Set the active discussion id so the active-discussion query fires and
        // populates messages from server truth.
        if (newDiscussionId) {
          setActiveDiscussionId(newDiscussionId);
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("Initial discussion stream failed:", err);
        }
      } finally {
        setStreamingInitial(false);
        setStreaming(false);
        setPhase(null);
        abortRef.current = null;
      }
    },
    [bookId, queryClient]
  );

  // Handle a new pending request from the parent (user clicked an "ask about"
  // affordance — floating toolbar, ToC dropdown, or "Ask the book").
  // ponytail: lastProcessedRef guards against React StrictMode's double-fire
  // in dev: both fires pass the SAME pendingRequest reference (state hasn't
  // propagated between them), so the ref check suppresses the duplicate POST.
  // A new click creates a new object reference, so legit back-to-back requests
  // still fire.
  useEffect(() => {
    if (!pendingRequest) return;
    if (lastProcessedRef.current === pendingRequest) return;
    lastProcessedRef.current = pendingRequest;
    startDiscussion(pendingRequest);
    onConsumed();
  }, [pendingRequest, startDiscussion, onConsumed]);

  // ponytail: cross-book arrival — auto-select the discussion the user jumped
  // to from another book. Mirrors the pendingRequest consumption pattern: ref
  // guard against StrictMode double-fire, consume once, signal the parent.
  // The ref resets when pendingOpenDiscussionId clears (null) so the SAME
  // discussion can be re-opened on a later hop (e.g., A→B→A via chip clicks).
  const lastPendingDiscussionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingOpenDiscussionId) {
      lastPendingDiscussionRef.current = null;
      return;
    }
    if (lastPendingDiscussionRef.current === pendingOpenDiscussionId) return;
    lastPendingDiscussionRef.current = pendingOpenDiscussionId;
    selectDiscussion(pendingOpenDiscussionId);
    onPendingDiscussionConsumed?.();
  }, [pendingOpenDiscussionId, onPendingDiscussionConsumed]);

  function selectDiscussion(id: string) {
    if (streaming) return;
    setActiveDiscussionId(id);
    setInitialContent("");
    setLocalMessages([]);
    setLocalContext(null);
    setDrafting(false);
    setDraftAttachments([]);
    setPendingAttachments([]);
    setDraftBook(null);
    setPendingBook(null);
  }

  function backToList() {
    if (streaming) return;
    setActiveDiscussionId(null);
    setInitialContent("");
    setLocalMessages([]);
    setLocalContext(null);
    setDrafting(false);
    setDraftAttachments([]);
    setPendingAttachments([]);
    setDraftBook(null);
    setPendingBook(null);
  }

  // ponytail: open a blank "New discussion" — no API call. The discussion is
  // created only when the user sends their opening question (sendDraftMessage).
  // Book is the in-context subject, so discussionType resolves to "book" and the
  // context chip shows "This book".
  function startDraft() {
    if (streaming) return;
    setActiveDiscussionId(null);
    setInitialContent("");
    setLocalMessages([]);
    setStreamingInitial(false);
    setPhase(null);
    setLocalContext({
      type: "book",
      passageText: null,
      passageCfi: null,
      sectionHref: null,
      sectionTitle: null,
    });
    setDrafting(true);
  }

  // ponytail: pop a discussion into the modal. Called from DiscussionView's header
  // expand button (no id — keep the current discussion) or ListView's per-row ⋯
  // menu (id given — select first, then open). Selecting from the list only
  // happens when no discussion is active, so selectDiscussion's `if (streaming) return`
  // guard can't fire here. Closes the sidebar so the modal gets full focus —
  // the bulb panel stays mounted (reader-sidebar lastTool), preserving state.
  function popOutDiscussion(id?: string) {
    if (id) selectDiscussion(id);
    setPoppedOut(true);
    onCloseSidebar?.();
  }

  // ponytail: inverse of popOutDiscussion — close the modal and reopen the
  // sidebar. The active discussion survives because the bulb panel never
  // unmounted (reader-sidebar lastTool keeps it alive while hidden).
  function returnToSidebar() {
    setPoppedOut(false);
    onReturnToSidebar?.();
  }

  // ponytail: wrap navigation so a citation jump from the panel OR an inline
  // link also closes the pop-out modal, revealing the reader. Built only when
  // the parent supplied onNavigateToHref; passed down to DiscussionView so both
  // the aggregate panel and inline MessageBubble links benefit.
  const navigateAndCloseModal = onNavigateToHref
    ? (href: string) => {
        onNavigateToHref(href);
        setPoppedOut(false);
      }
    : undefined;
  // ponytail: CFI-precise passage deeplink, mirrors navigateAndCloseModal.
  const navigateCfiAndCloseModal = onNavigateToCfi
    ? (cfi: string) => {
        onNavigateToCfi(cfi);
        setPoppedOut(false);
      }
    : undefined;
  // ponytail: cross-book deeplink, mirrors the two above.
  const navigateBookAndCloseModal = onNavigateToBookSection
    ? (bookId: string, basename: string) => {
        onNavigateToBookSection(bookId, basename, activeDiscussionId ?? undefined);
        setPoppedOut(false);
      }
    : undefined;

  // ponytail: wrap onOpenBook to inject activeDiscussionId — same pattern as
  // navigateBookAndCloseModal. The chip click fires with just bookId; the
  // wrapper adds the discussion context so the destination book reopens the
  // discussion in the Discussions panel.
  const openBookHandler = onOpenBook
    ? (bookId: string) => {
        onOpenBook(bookId, activeDiscussionId ?? undefined);
      }
    : undefined;

  // ponytail: shelf discussions cite books across the library via #ch:<bookId>:
  // <basename> links but have no attachments → attachedBookHrefs would be empty
  // and the links degrade to plain text. Parse cited bookIds from the messages
  // and batch-fetch their spine hrefs (access-checked server-side). Safe to
  // call unconditionally — returns {} when nothing is cited (non-shelf).
  const shelfCitedHrefs = useShelfCitedHrefs(localMessages);
  const isShelfDiscussion =
    (activeData?.discussion as { type?: string } | undefined)?.type === "shelf";

  // ponytail: hrefs for each ATTACHED (co-primary) book, keyed by bookId. The
  // renderer validates #ch:<bookId>:<basename> citations against the TARGET
  // book's hrefs (not the open book's spine — that's the origin book). Sourced
  // from each attachment's DB tocJson (included by getDiscussionWithMessages).
  // Recomputed when the discussion refetch lands new/removed attachments.
  //
  // For SHELF discussions there are no attachments; the cited books' hrefs
  // come from shelfCitedHrefs instead.
  //
  // ALSO includes the ORIGIN book's hrefs when viewing from a co-primary (non-
  // origin) book — so the origin book's unprefixed #ch: citations get a second
  // validation chance via the renderer's originBookId fallback. Without this,
  // origin citations degrade to plain text when the discussion is opened from
  // a different book's list.
  const { attachedBookHrefs, originBookId } = useMemo(() => {
    if (isShelfDiscussion) {
      return {
        attachedBookHrefs:
          Object.keys(shelfCitedHrefs).length > 0 ? shelfCitedHrefs : undefined,
        originBookId: undefined as string | undefined,
      };
    }
    const d = activeData?.discussion as
      | {
          bookId: string;
          book?: { id: string; title: string; tocJson: string | null } | null;
          attachments?: {
            type: string;
            bookId: string | null;
            book?: { id: string; tocJson: string | null } | null;
          }[];
        }
      | undefined;
    const map: Record<string, string[]> = {};

    // Attached (co-primary) books
    for (const a of d?.attachments ?? []) {
      if (a.type !== "book" || !a.bookId || !a.book) continue;
      try {
        const toc = JSON.parse(a.book.tocJson ?? "[]") as Array<{ href?: string }>;
        const hrefs = toc.map((t) => hrefBasename(t.href ?? "")).filter((h) => h.length > 0);
        if (hrefs.length > 0) map[a.book.id] = hrefs;
      } catch { /* skip unparseable */ }
    }

    // Origin book — add its hrefs when viewing from a different book
    let originId: string | undefined;
    if (d?.book && d.book.id !== bookId) {
      originId = d.book.id;
      try {
        const toc = JSON.parse(d.book.tocJson ?? "[]") as Array<{ href?: string }>;
        const hrefs = toc.map((t) => hrefBasename(t.href ?? "")).filter((h) => h.length > 0);
        if (hrefs.length > 0 && !map[d.book.id]) map[d.book.id] = hrefs;
      } catch { /* skip unparseable */ }
    }

    return {
      attachedBookHrefs: Object.keys(map).length > 0 ? map : undefined,
      originBookId: originId,
    };
  }, [activeData, bookId, isShelfDiscussion, shelfCitedHrefs]);

  // ─── Follow-up composer ─────────────────────────────────────────────────
  const [input, setInput] = useState("");

  async function sendFollowup() {
    const text = input.trim();
    if (!text || streaming || !activeDiscussionId) return;

    // ponytail: index-based update — append placeholder assistant message
    // and update by index during streaming. Object-reference equality fails
    // after the first chunk update (see playground bug from earlier session).
    // createdAt is synthesized so mergeTimeline can place attachment-event
    // markers relative to this turn; the sync effect replaces it with server
    // truth on the next refetch.
    const assistantIndex = localMessages.length + 1;
    const nowIso = new Date().toISOString();
    const nextMessages = [...localMessages, { role: "user" as const, content: text, createdAt: nowIso }];
    setLocalMessages([...nextMessages, { role: "assistant", content: "", createdAt: nowIso }]);
    setInput("");
    setStreaming(true);
    // ponytail: snapshot drafts for the POST body, then move them to
    // pendingAttachments (rendered without an x — they're committed) instead of
    // clearing. The chip stays visible through the stream; the confirm effect
    // retires them from pending once the active-discussion refetch lands them
    // in persistedAttachments. This closes the "chip vanishes after send" gap.
    const sendingAttachments = draftAttachments;
    if (sendingAttachments.length > 0) {
      setPendingAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.sectionHref));
        return [
          ...prev,
          ...sendingAttachments.filter((a) => !seen.has(a.sectionHref)),
        ];
      });
      setDraftAttachments([]);
    }
    // ponytail: snapshot the draft book (single slot) and move it to pending so
    // the chip holds steady through the stream; the confirm effect retires it
    // once the refetch lands it in persistedBook.
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
      const res = await fetch(
        `/api/discussions/${activeDiscussionId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: text,
            attachments: attachmentsPayload.length > 0 ? attachmentsPayload : undefined,
          }),
          signal: controller.signal,
        }
      );

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
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "error") {
              console.error("Follow-up failed:", parsed.error);
              setLocalMessages((prev) =>
                prev.filter((_, i) => i !== assistantIndex)
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
            // Skip malformed
          }
        }
      }

      // Invalidate list to refresh updatedAt ordering
      queryClient.invalidateQueries({ queryKey: ["discussions", bookId] });
      // ponytail: refetch the active discussion so newly-persisted attachments
      // surface as permanent chips (persistedAttachments derives from
      // activeData.discussion.attachments). Without this the chip we just sent
      // disappears — drafts were cleared optimistically and the server truth
      // never arrives. Safe post-stream: messages are persisted, the sync
      // effect resets localMessages from server truth as the correct end state.
      queryClient.invalidateQueries({ queryKey: ["discussion", activeDiscussionId] });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("Follow-up fetch failed:", err);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  // ponytail: the opening turn of a blank "New discussion". POSTs {message}
  // to the discussions endpoint, which creates the discussion (no explainer) and
  // streams the book's answer. The discussionId arrives in the stream; we pin
  // activeDiscussionId only AFTER streaming completes to avoid the active-discussion
  // query racing in and clobbering the in-flight assistant bubble.
  async function sendDraftMessage() {
    const text = input.trim();
    if (!text || streaming || !drafting) return;

    const assistantIndex = localMessages.length + 1;
    const nowIso = new Date().toISOString();
    const nextMessages = [...localMessages, { role: "user" as const, content: text, createdAt: nowIso }];
    setLocalMessages([...nextMessages, { role: "assistant", content: "", createdAt: nowIso }]);
    setInput("");
    setStreaming(true);

    // ponytail: snapshot drafts → pending so chips hold steady through the
    // stream; the confirm effect retires them once the active-discussion
    // refetch lands them as persisted (same machinery sendFollowup uses —
    // activeDiscussionId is pinned post-stream below).
    const sendingAttachments = draftAttachments;
    if (sendingAttachments.length > 0) {
      setPendingAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.sectionHref));
        return [
          ...prev,
          ...sendingAttachments.filter((a) => !seen.has(a.sectionHref)),
        ];
      });
      setDraftAttachments([]);
    }
    const sendingBook = draftBook;
    if (sendingBook) {
      setPendingBook(sendingBook);
      setDraftBook(null);
    }
    const sectionPayload = sendingAttachments.map((a) => ({
      type: a.type,
      sectionHref: a.sectionHref,
    }));
    const bookPayload = sendingBook ? [{ type: "book", bookId: sendingBook.bookId }] : [];
    const attachmentsPayload = [...sectionPayload, ...bookPayload];

    const controller = new AbortController();
    abortRef.current = controller;
    let newDiscussionId: string | null = null;

    try {
      const res = await fetch("/api/discussions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          type: "book",
          message: text,
          ...(attachmentsPayload.length > 0 ? { attachments: attachmentsPayload } : {}),
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
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "error") {
              console.error("Draft first turn failed:", parsed.error);
              setLocalMessages((prev) =>
                prev.filter((_, i) => i !== assistantIndex)
              );
              return;
            }
            if (parsed.type === "discussion" && parsed.discussionId) {
              newDiscussionId = parsed.discussionId;
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
            // Skip malformed
          }
        }
      }
      queryClient.invalidateQueries({ queryKey: ["discussions", bookId] });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("Draft first turn failed:", err);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Pin the discussion now that streaming is done — the active-discussion query
      // loads the fully-persisted conversation (no race on the assistant msg).
      setDrafting(false);
      if (newDiscussionId) setActiveDiscussionId(newDiscussionId);
    }
  }

  async function handleDeleteDiscussion(id: string) {
    try {
      const res = await fetch(`/api/discussions/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        queryClient.invalidateQueries({
          queryKey: ["discussions", bookId],
        });
        if (id === activeDiscussionId) backToList();
      } else {
        console.error(
          "[DiscussionsPanel] delete discussion failed:",
          res.status
        );
      }
    } catch (err) {
      console.error("[DiscussionsPanel] delete discussion failed:", err);
    }
  }

  async function handlePurgeCache(discussion: DiscussionPreview) {
    if (!discussion.explainer) return;
    try {
      const res = await fetch(`/api/explainers/${discussion.explainer.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        queryClient.invalidateQueries({
          queryKey: ["discussions", bookId],
        });
        setDiscussionToPurge(null);
        if (discussion.id === activeDiscussionId) backToList();
      } else {
        console.error(
          "[DiscussionsPanel] purge cache failed:",
          res.status
        );
      }
    } catch (err) {
      console.error("[DiscussionsPanel] purge cache failed:", err);
    }
  }

  async function handleReroll(explainerId: string) {
    setRerolling(true);
    setRerollContent("");
    setRerollPhase(null);
    setRerollResult(null);
    try {
      const res = await fetch(`/api/explainers/${explainerId}/reroll`, {
        method: "POST",
      });
      if (!res.body) return;
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
          const data = line.slice(6).trim();
          if (data === "[DONE]" || !data) continue;
          try {
            const p = JSON.parse(data);
            if (p.type === "error") {
              console.error("[reroll] failed:", p.error);
              break;
            }
            if (p.type === "status") setRerollPhase(p.stage as "explaining" | "refining");
            if (p.type === "chunk") setRerollContent((c) => c + p.chunk);
            if (p.type === "version") setRerollResult(p.version as number);
          } catch {
            // skip malformed
          }
        }
      }
      // Refresh latestVersion on the active discussion so the "newer version"
      // indicator updates immediately.
      queryClient.invalidateQueries({
        queryKey: ["discussion", activeDiscussionId],
      });
    } catch (err) {
      console.error("[reroll] failed:", err);
    } finally {
      setRerolling(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  // ponytail: during initial stream, activeData isn't loaded yet — derive the
  // discussion type + passage text from the pendingRequest so the indicator can
  // render meaningfully before the server roundtrip completes.
  const activeDiscussion = activeData?.discussion as
    | {
        type?: DiscussionType;
        passageText?: string | null;
        passageCfi?: string | null;
        sectionHref?: string | null;
        initialCacheHit?: boolean | null;
        latestVersion?: number;
        explainer?: { id?: string; version?: number };
      }
    | undefined;
  const discussionType: DiscussionType =
    activeDiscussion?.type ?? localContext?.type ?? pendingRequest?.type ?? "book";
  const discussionPassageText: string | null =
    activeDiscussion?.passageText ??
    localContext?.passageText ??
    (pendingRequest?.type === "passage" ? pendingRequest.text : null) ??
    null;
  const discussionPassageCfi: string | null =
    activeDiscussion?.passageCfi ?? localContext?.passageCfi ?? null;
  const discussionSectionHref: string | null =
    activeDiscussion?.sectionHref ?? localContext?.sectionHref ?? null;
  // ponytail: prefer the click-time ToC title (localContext, shown immediately),
  // then the ToC resolver (reopened discussions), then the raw href as last resort.
  const discussionSectionLabel: string =
    localContext?.sectionTitle ??
    (discussionSectionHref ? resolveSectionLabel?.(discussionSectionHref) : undefined) ??
    discussionSectionHref ??
    "";
  // ponytail: admin-only metadata for the explainer badge / cache chip /
  // newer-version indicator / regenerate action.
  const adminMeta =
    isAdmin && activeDiscussion?.explainer
      ? {
          explainerId: activeDiscussion.explainer.id!,
          version: activeDiscussion.explainer.version ?? 1,
          latestVersion: activeDiscussion.latestVersion ?? activeDiscussion.explainer.version ?? 1,
          initialCacheHit: activeDiscussion.initialCacheHit ?? null,
        }
      : undefined;

  // ponytail: permanently-attached sections (server-side). Labels resolved via
  // resolveSectionLabel (ToC basename match); fall back to raw href. These have
  // no "x" — once sent, they are re-sent on every follow-up (see services/discussions.ts).
  const persistedAttachments: { type: "section"; sectionHref: string; label: string }[] = (
    (activeData?.discussion as { attachments?: { type: string; sectionHref: string | null }[] } | undefined)
      ?.attachments ?? []
  )
    .filter((a) => a.type === "section" && a.sectionHref)
    .map((a) => ({
      type: "section" as const,
      sectionHref: a.sectionHref as string,
      label: resolveSectionLabel?.(a.sectionHref as string) ?? (a.sectionHref as string),
    }));

  // ponytail: pending = sent-but-not-yet-confirmed. Once the active-discussion
  // refetch lands them in persistedAttachments, the confirm effect below retires
  // them. Dedup against persisted here so a chip never renders twice during the
  // handoff window.
  const pendingDisplay = pendingAttachments.filter(
    (p) => !persistedAttachments.some((a) => a.sectionHref === p.sectionHref)
  );

  // Hrefs already represented in the context row (origin + draft + pending +
  // persisted) — excluded from the picker so the user can't attach a duplicate.
  const attachedHrefs = new Set<string>([
    ...(discussionSectionHref ? [discussionSectionHref] : []),
    ...draftAttachments.map((a) => a.sectionHref),
    ...pendingDisplay.map((a) => a.sectionHref),
    ...persistedAttachments.map((a) => a.sectionHref),
  ]);
  const pickerOptions = (sectionOptions ?? []).filter((s) => s.label && !attachedHrefs.has(s.href));

  // ponytail: permanently-attached "other book" (server-side, single slot — the
  // per-tier cap is usually 1). The API includes the book's display fields so we
  // can render the chip directly. Reopened discussions restore from here.
  const persistedBook: BookAttachment | null = (() => {
    const att = (
      activeData?.discussion as
        | {
            attachments?: {
              type: string;
              bookId: string | null;
              book?: { id: string; title: string; author: string | null; coverPath: string | null; txtTokens: number | null } | null;
            }[];
          }
        | undefined
    )?.attachments;
    const bookAtt = (att ?? []).find((a) => a.type === "book" && a.bookId && a.book);
    if (!bookAtt || !bookAtt.book) return null;
    return {
      bookId: bookAtt.book.id,
      title: bookAtt.book.title,
      author: bookAtt.book.author,
      coverPath: bookAtt.book.coverPath,
      txtTokens: bookAtt.book.txtTokens,
    };
  })();
  // ponytail: when viewing from a co-primary (non-origin) book, show the origin
  // book as a named context chip — it's "another book" from the viewer's
  // perspective. "This book" implicitly means the currently-open book. Null
  // when viewing from the origin (no chip needed — "This book" covers it).
  const originBookChip: BookAttachment | null = (() => {
    const d = activeData?.discussion as
      | {
          bookId: string;
          book?: { id: string; title: string; author: string | null; coverPath: string | null } | null;
        }
      | undefined;
    if (!d?.book || d.bookId === bookId) return null;
    return {
      bookId: d.book.id,
      title: d.book.title,
      author: d.book.author,
      coverPath: d.book.coverPath,
      txtTokens: null,
    };
  })();
  // ponytail: pending book chip retires once the refetch lands it in persistedBook.
  const pendingBookDisplay =
    pendingBook && persistedBook?.bookId !== pendingBook.bookId ? pendingBook : null;
  // ponytail: timeline event markers for mid-conversation attachments (books +
  // sections). Turn-0 attachments (created with the discussion in the same
  // request) are foundational context, not events — suppressed via
  // isTurnZeroAttachment. hasMidConvoBookAddition gates the "Original" badge
  // AND the start-of-thread "Started from" marker: only show them when a book
  // was genuinely added later, otherwise every book present at turn 0 is
  // co-original and the label carries no information. originBook feeds the
  // start marker (title + cover) — the discussion.book relation, regardless of
  // which book the reader is currently viewing from. isOriginView tells the
  // "This book" chip whether it represents the origin.
  const {
    timelineEvents,
    hasMidConvoBookAddition,
    isOriginView,
    originBook,
  } = (() => {
    const d = activeData?.discussion as
      | {
          bookId: string;
          createdAt?: string;
          book?: { id: string; title: string; coverPath: string | null } | null;
          attachments?: {
            type: string;
            sectionHref: string | null;
            bookId: string | null;
            createdAt: string;
            book?: { id: string; title: string; coverPath: string | null } | null;
          }[];
        }
      | undefined;
    const dCreated = d?.createdAt;
    const events: TimelineEvent[] = [];
    let midConvoBook = false;
    for (const a of d?.attachments ?? []) {
      if (dCreated && isTurnZeroAttachment(a.createdAt, dCreated)) continue;
      if (a.type === "book" && a.bookId && a.book) {
        midConvoBook = true;
        events.push({
          kind: "book-added",
          createdAt: a.createdAt,
          label: a.book.title,
          coverPath: a.book.coverPath,
          bookId: a.book.id,
        });
      } else if (a.type === "section" && a.sectionHref) {
        events.push({
          kind: "section-added",
          createdAt: a.createdAt,
          label: resolveSectionLabel?.(a.sectionHref) ?? a.sectionHref,
          sectionHref: a.sectionHref,
        });
      }
    }
    return {
      timelineEvents: events,
      hasMidConvoBookAddition: midConvoBook,
      isOriginView: !!d && d.bookId === bookId,
      originBook: d?.book
        ? { bookId: d.book.id, title: d.book.title, coverPath: d.book.coverPath }
        : null,
    };
  })();
  // Slots remaining for attaching other books (0..max), counting persisted +
  // draft + pending so the picker hides at the cap.
  const bookSlotsRemaining = Math.max(
    0,
    (attachBookMax ?? 0) -
      (persistedBook ? 1 : 0) -
      (draftBook ? 1 : 0) -
      (pendingBookDisplay ? 1 : 0)
  );

  // ponytail: retire pending attachments once the active-discussion refetch
  // confirms them as persisted. Runs only when persistedAttachments changes
  // (i.e. after a refetch), so spurious refetches can't drop unsent drafts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pendingAttachments.length === 0) return;
    const confirmed = new Set(persistedAttachments.map((a) => a.sectionHref));
    setPendingAttachments((prev) => {
      const next = prev.filter((p) => !confirmed.has(p.sectionHref));
      // ponytail: bail when nothing retired — returning the same ref lets React
      // skip the re-render. Without this, persistedAttachments being a fresh
      // array every render + this setState = infinite loop when a pending
      // section hasn't landed server-side yet (e.g. right after attach + follow-up).
      return next.length === prev.length ? prev : next;
    });
  }, [persistedAttachments]);

  function addDraftAttachment(href: string, label: string) {
    if (attachedHrefs.has(href)) return;
    setDraftAttachments((prev) => [...prev, { type: "section", sectionHref: href, label }]);
  }
  function removeDraftAttachment(href: string) {
    setDraftAttachments((prev) => prev.filter((a) => a.sectionHref !== href));
  }

  // ponytail: retire pendingBook once the refetch lands it in persistedBook.
  useEffect(() => {
    if (!pendingBook) return;
    if (persistedBook?.bookId === pendingBook.bookId) setPendingBook(null);
  }, [persistedBook]);

  function addDraftBook(b: BookAttachment) {
    if (bookSlotsRemaining <= 0) return;
    setDraftBook(b);
  }
  function removeDraftBook() {
    setDraftBook(null);
  }

  // ponytail: single render fn feeds both the sidebar slot and the pop-out
  // Dialog. State lives in this panel, so both views stay in sync by
  // construction. `inModal` flips the header's expand button off (redundant
  // inside the modal) and reserves room for the Dialog's X close button.
  // Plain function (not useCallback) — closes over fresh state every render,
  // and no memoized child needs a stable reference.
  function renderPanelContent(inModal: boolean) {
    if (activeDiscussionId || streamingInitial || drafting) {
      return (
        <DiscussionView
          initialContent={initialContent}
          streamingInitial={streamingInitial}
          phase={phase}
          messages={localMessages}
          input={input}
          setInput={setInput}
          streaming={streaming}
          onSend={drafting ? sendDraftMessage : sendFollowup}
          composerPlaceholder={
            drafting ? "Ask anything about this book…" : "Ask a follow-up…"
          }
          onBack={backToList}
          discussionType={discussionType}
          discussionPassageText={discussionPassageText}
          discussionPassageCfi={discussionPassageCfi}
          discussionSectionHref={discussionSectionHref}
          discussionSectionLabel={discussionSectionLabel}
          bookTxtTokens={bookTxtTokens}
          contextWindow={contextWindow}
          inModal={inModal}
          onPopOut={() => popOutDiscussion()}
          onReturnToSidebar={returnToSidebar}
          onNavigateToHref={navigateAndCloseModal}
          onNavigateToCfi={navigateCfiAndCloseModal}
          onNavigateToBookSection={navigateBookAndCloseModal}
          onOpenBook={openBookHandler}
          attachedBookHrefs={attachedBookHrefs}
          originBookId={originBookId}
          spineItems={spineItems}
          adminMeta={adminMeta}
          isAdmin={isAdmin}
          onReroll={handleReroll}
          rerolling={rerolling}
          rerollContent={rerollContent}
          rerollPhase={rerollPhase}
          rerollResult={rerollResult}
          persistedAttachments={persistedAttachments}
          pendingAttachments={pendingDisplay}
          draftAttachments={draftAttachments}
          pickerOptions={pickerOptions}
          onAddDraftAttachment={addDraftAttachment}
          onRemoveDraftAttachment={removeDraftAttachment}
          currentBookId={bookId}
          originBookChip={originBookChip}
          persistedBook={persistedBook}
          pendingBook={pendingBookDisplay}
          draftBook={draftBook}
          onAddDraftBook={addDraftBook}
          onRemoveDraftBook={removeDraftBook}
          attachBookMax={attachBookMax ?? 0}
          timelineEvents={timelineEvents}
          hasMidConvoBookAddition={hasMidConvoBookAddition}
          isOriginView={isOriginView}
          originBook={originBook}
        />
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-9">
        <div className="px-12">
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={startDraft}
            disabled={streaming}
          >
            <Lightbulb />
            New discussion
          </Button>
        </div>
        <ListView
          discussions={discussions}
          loading={listLoading}
          currentBookId={bookId}
          onSelect={selectDiscussion}
          onPopOut={popOutDiscussion}
          onDelete={handleDeleteDiscussion}
          onPurge={setDiscussionToPurge}
          isAdmin={isAdmin}
          emptyHint="Start a 'New discussion' about the whole book, or select text and click 'Ask about this' for a passage."
          resolveSectionLabel={resolveSectionLabel}
        />
      </div>
    );
  }

  return (
    <>
      {renderPanelContent(false)}
      <Dialog open={poppedOut} onOpenChange={setPoppedOut}>
        <DialogContent className="flex h-[80vh] max-h-[80vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {/*
            ponytail: Radix requires a DialogTitle for SR announcement. The
            visible header inside DiscussionView already says "Discussion"; this
            sr-only title satisfies the a11y requirement without duplicating
            visible text.
          */}
          <DialogTitle className="sr-only">Discussion</DialogTitle>
          {renderPanelContent(true)}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!discussionToPurge}
        onOpenChange={(open) => !open && setDiscussionToPurge(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Purge cached explainer?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes this version of the shared explainer cache.
              Discussions pinned to it move to the latest remaining version
              (or are removed if no other version exists). New requests will
              regenerate it. Prefer &quot;Regenerate&quot; to create a new version
              without losing the old one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDiscussionToPurge(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => discussionToPurge && handlePurgeCache(discussionToPurge)}
            >
              Purge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Sub-components (same file, ponytail) ──────────────────────────────────

function ListView({
  discussions,
  loading,
  currentBookId,
  onSelect,
  onPopOut,
  onDelete,
  onPurge,
  isAdmin,
  emptyHint,
  resolveSectionLabel,
}: {
  discussions: DiscussionPreview[];
  loading: boolean;
  currentBookId?: string;
  onSelect: (id: string) => void;
  onPopOut: (id: string) => void;
  onDelete: (id: string) => void;
  onPurge: (discussion: DiscussionPreview) => void;
  isAdmin: boolean;
  emptyHint: string;
  resolveSectionLabel?: (href: string) => string | undefined;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (discussions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
        <Lightbulb className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm font-medium text-foreground">No discussions yet</p>
        <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }
  return (
    // ponytail: SmoothScrollArea provides Lenis momentum + fade-in thumb on
    // desktop (≥1024px), native overflow-y-auto on tablet/reduced-motion.
    // flex-1 + min-h-0 so heights propagate from the sidebar's flex-col parent.
    <SmoothScrollArea className="flex-1 min-h-0">
      <div className="py-2">
      <p className="px-4 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Discussions
      </p>
      <ul className="space-y-1">
        {discussions.map((t) => (
          <li key={t.id}>
            {/*
              ponytail: row is a div role=button (not a <button>) so the
              nested DropdownMenuTrigger can render its own <button> legally —
              nested <button>s are invalid HTML. onKeyDown handles Enter/Space
              for a11y; onClick covers mouse. pr-6 on inner content reserves
              room for the absolutely-positioned ⋯ at top-right.
            */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(t.id);
                }
              }}
              className="group relative w-full cursor-pointer rounded-none px-4 py-2 text-left hover:bg-muted/50"
            >
              <div className="mb-0.5 flex items-center gap-2 pr-6">
                <Lightbulb className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="text-xs capitalize text-muted-foreground">
                  {t.type}
                </span>
                {t._count.messages > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {t._count.messages}
                  </Badge>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground transition-opacity group-hover:opacity-0 focus-within:opacity-0">
                  {formatRelative(t.updatedAt)}
                </span>
              </div>
              <p className="line-clamp-2 pr-6 text-xs text-foreground">
                {t.passageText
                  ? t.passageText.slice(0, 120)
                  : t.sectionHref
                  ? resolveSectionLabel?.(t.sectionHref) ?? t.sectionHref
                  : "Whole book"}
              </p>
              {/*
                ponytail: cross-listed hint. When this discussion's origin book
                differs from the currently-open book (it was attached as co-
                primary from another book), show a subtle "with {originTitle}"
                line so the user understands why it's here — without implying
                secondary status. Covers the union-query case in Part 5.
              */}
              {t.book && currentBookId && t.book.id !== currentBookId && (
                <p className="mt-0.5 pr-6 text-[10px] italic text-muted-foreground/70">
                  with {t.book.title}
                </p>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Discussion actions"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onPopOut(t.id)}>
                    <Maximize2 className="h-3.5 w-3.5" />
                    Pop out
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDelete(t.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    Delete
                  </DropdownMenuItem>
                  {isAdmin && t.explainer && (
                    <DropdownMenuItem onClick={() => onPurge(t)}>
                      <Database className="h-3.5 w-3.5 text-destructive" />
                      Purge cached explainer (admin)
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>
        ))}
      </ul>
      </div>
    </SmoothScrollArea>
  );
}

function DiscussionView({
  initialContent,
  streamingInitial,
  phase,
  messages,
  input,
  setInput,
  streaming,
  onSend,
  composerPlaceholder,
  onBack,
  discussionType,
  discussionPassageText,
  discussionPassageCfi,
  discussionSectionHref,
  discussionSectionLabel,
  bookTxtTokens,
  contextWindow,
  inModal,
  onPopOut,
  onReturnToSidebar,
  onNavigateToHref,
  onNavigateToCfi,
  onNavigateToBookSection,
  onOpenBook,
  attachedBookHrefs,
  originBookId,
  spineItems,
  adminMeta,
  isAdmin,
  onReroll,
  rerolling,
  rerollContent,
  rerollPhase,
  rerollResult,
  persistedAttachments,
  pendingAttachments,
  draftAttachments,
  pickerOptions,
  onAddDraftAttachment,
  onRemoveDraftAttachment,
  currentBookId,
  originBookChip,
  persistedBook,
  pendingBook,
  draftBook,
  onAddDraftBook,
  onRemoveDraftBook,
  attachBookMax,
  timelineEvents,
  hasMidConvoBookAddition,
  isOriginView,
  originBook,
}: {
  initialContent: string;
  streamingInitial: boolean;
  phase: "explaining" | "refining" | null;
  messages: Message[];
  input: string;
  setInput: (v: string) => void;
  streaming: boolean;
  onSend: () => void;
  composerPlaceholder?: string;
  onBack: () => void;
  discussionType: DiscussionType;
  discussionPassageText: string | null;
  discussionPassageCfi?: string | null;
  discussionSectionHref?: string | null;
  discussionSectionLabel?: string;
  bookTxtTokens?: number | null;
  contextWindow?: number;
  inModal?: boolean;
  onPopOut: () => void;
  onReturnToSidebar: () => void;
  onNavigateToHref?: (href: string) => void;
  onNavigateToCfi?: (cfi: string) => void;
  onNavigateToBookSection?: (bookId: string, basename: string) => void;
  attachedBookHrefs?: Record<string, string[]>;
  originBookId?: string;
  spineItems?: SpineItem[];
  adminMeta?: {
    explainerId: string;
    version: number;
    latestVersion: number;
    initialCacheHit: boolean | null;
  };
  isAdmin?: boolean;
  onReroll?: (explainerId: string) => void;
  rerolling?: boolean;
  rerollContent?: string;
  rerollPhase?: "explaining" | "refining" | null;
  rerollResult?: number | null;
  persistedAttachments?: { type: "section"; sectionHref: string; label: string }[];
  pendingAttachments?: { type: "section"; sectionHref: string; label: string }[];
  draftAttachments?: { type: "section"; sectionHref: string; label: string }[];
  pickerOptions?: { href: string; label: string }[];
  onAddDraftAttachment?: (href: string, label: string) => void;
  onRemoveDraftAttachment?: (href: string) => void;
  currentBookId?: string;
  originBookChip?: BookAttachment | null;
  onOpenBook?: (bookId: string) => void;
  persistedBook?: BookAttachment | null;
  pendingBook?: BookAttachment | null;
  draftBook?: BookAttachment | null;
  onAddDraftBook?: (b: BookAttachment) => void;
  onRemoveDraftBook?: () => void;
  attachBookMax?: number;
  // ponytail: mid-conversation attachment events rendered inline in the message
  // timeline (books + sections; turn-0 already filtered out by the caller).
  timelineEvents?: TimelineEvent[];
  // ponytail: gates the "Original" badge — true only when a book was added after
  // turn 0. When false, all books are co-original and the label is noise.
  hasMidConvoBookAddition?: boolean;
  // ponytail: true when the currently-open book IS the discussion's origin book.
  // Drives whether the "This book" chip (vs the originBookChip) wears the badge.
  isOriginView?: boolean;
  // ponytail: the discussion's origin book (id/title/cover), regardless of the
  // current view. Feeds the start-of-thread "Started from" marker — the
  // companion to the mid-conversation "Added" markers, pinned to the top.
  originBook?: { bookId: string; title: string; coverPath: string | null } | null;
}) {
  // ponytail: library list for the "attach another book" picker. Reuses the
  // existing GET /api/books (= getPersonalLibrary). Fetched lazily only when
  // the book picker opens, cached globally by react-query so the shelf + this
  // picker share one round-trip.
  const bookEnabled = (attachBookMax ?? 0) >= 1;
  // ponytail: the unified attach Popover is ONE floating layer whose content
  // swaps between a kind chooser and a searchable Command. Chaining a menu item
  // into a second Popover races the menu's teardown and the popover closes
  // instantly — so we keep it single-layer with local view state.
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachView, setAttachView] = useState<"menu" | "section" | "book">("menu");
  const [bookQueryEnabled, setBookQueryEnabled] = useState(false);
  const { data: libraryData } = useQuery({
    queryKey: ["library"],
    queryFn: async () => {
      const res = await fetch("/api/books");
      if (!res.ok) throw new Error("Failed to load library");
      return res.json();
    },
    enabled: bookEnabled && bookQueryEnabled,
  });
  const bookSlotsRemaining = Math.max(
    0,
    (attachBookMax ?? 0) -
      (persistedBook ? 1 : 0) -
      (draftBook ? 1 : 0) -
      (pendingBook ? 1 : 0)
  );

  const spineHrefs = (spineItems ?? []).map((s) => s.href);

  // ponytail: autofocus the composer when rendered in the pop-out modal.
  // ponytail: focus the composer when a discussion opens (mount) and whenever a
  // generation finishes, so the user can immediately compose their next
  // question. Fires in the sidebar AND the pop-out modal. The textarea is never
  // disabled, so the cursor is always available even mid-generation.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, [streaming, streamingInitial]);

  // ponytail: scroll-follow gate for follow-up streams. When a reply is
  // streaming (streaming && !streamingInitial), `autoScroll` follows the
  // live edge ONLY while the reader is already at the bottom (latched). The
  // layout effect clears the latch synchronously before paint when a
  // follow-up generation starts, so the previous render's `latched=true`
  // (reader was at bottom in idle state) doesn't carry through stream start
  // and yank the user's just-pinned question off the top as the assistant
  // bubble grows past the viewport. The ScrollLatch child re-populates
  // `latched` from the primitive's viewport-edge state once the reader
  // scrolls — false (off) when scrolled up, true (on) when scrolled back down.
  // Initial-explainer streams (streamingInitial) are excluded: there is no
  // user anchor to pin, so live-edge follow is the desired default.
  const [latched, setLatched] = useState(true);
  const prevFollowupStreamingRef = useRef(false);
  useLayoutEffect(() => {
    const followupStreaming = streaming && !streamingInitial;
    if (followupStreaming && !prevFollowupStreamingRef.current) {
      setLatched(false);
    }
    prevFollowupStreamingRef.current = followupStreaming;
  }, [streaming, streamingInitial]);
  const autoScroll = streaming && !streamingInitial ? latched : true;

  // ponytail: phase label only matters while the user is staring at an empty
  // (or growing) bubble. "Explaining" = hidden pass 1 running, nothing shown
  // yet; "Refining" = pass 2 streaming. One-pass explainers never set phase.
  const phaseLabel =
    phase === "explaining"
      ? "Explaining the book…"
      : phase === "refining"
      ? "Refining the explanation…"
      : null;

  // ponytail: X% full indicator. The dominant term is bookTxtTokens — the
  // full book plaintext is re-sent in the system prompt on every follow-up
  // (see rebuildSystemPrompt in discussions.ts). Also counts the
  // passage focus text (passage discussions), the initial explainer response
  // (sent as the first assistant message), all follow-up messages, the
  // current draft, and a small per-type template-overhead constant.
  // Returns null when inputs are missing (book size pending or window
  // unknown) — caller hides the indicator in that case.
  const indicator = computeContextIndicator({
    bookTxtTokens,
    contextWindow,
    initialContent,
    messages,
    inputDraft: input,
    discussionType,
    discussionPassageText,
    // ponytail: count the attached book's full text so the bar reflects the
    // real cost before the user sends. Prefer draft (about to be sent), then
    // pending (just sent), then persisted (already in context).
    attachedBookTokens: draftBook?.txtTokens ?? pendingBook?.txtTokens ?? persistedBook?.txtTokens ?? null,
  });
  const pct = indicator?.pct ?? null;
  const overBudget = indicator?.overBudget ?? false;
  const fullLabel = indicator?.label ?? "";

  return (
    <div className={cn("flex flex-col", inModal ? "min-h-0 flex-1 overflow-hidden" : "h-full")}>
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border px-2 py-2",
          // ponytail: reserve room for the Dialog's absolute top-2 right-2 X
          // when rendered inside the modal so it doesn't overlap the indicator
          // or the Minimize2 return button. pr-12 (48px) gives the return
          // button breathing room from the X (X spans ~8–36px from the edge).
          inModal && "pr-12"
        )}
      >
        <Button
          size="sm"
          variant="ghost"
          onClick={onBack}
          disabled={streaming}
          className="h-7"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back
        </Button>
        <span className="text-xs text-muted-foreground">Discussion</span>
        <div className="ml-auto flex items-center gap-2">
          {pct !== null && (
            <span
              className="text-[11px] tabular-nums text-muted-foreground"
              title={fullLabel}
            >
              {Math.round(pct)}% full
            </span>
          )}
          {/*
            ponytail: Maximize2 pops the discussion into the modal (sidebar only);
            Minimize2 returns it to the sidebar (modal only). Symmetric icons
            convey the inverse actions. size="icon-sm" is h-7 w-7, matching
            the Back button's height.
          */}
          {!inModal ? (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onPopOut}
              title="Pop out"
              aria-label="Pop out"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onReturnToSidebar}
              title="Return to sidebar"
              aria-label="Return to sidebar"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {pct !== null && (
        <div
          className="h-1 w-full bg-muted overflow-hidden"
          title={fullLabel}
        >
          <div
            className={cn(
              "h-full transition-all",
              overBudget ? "bg-destructive" : "bg-primary"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <MessageScrollerProvider
        // ponytail: MessageScroller implements the "new-turn anchoring"
        // behavior we want — when a new anchor (user message) is appended,
        // the viewport moves it near the top and keeps a peek of the previous
        // item above so the new turn doesn't feel detached from its context.
        // autoScroll follows the live edge ONLY while the reader is already
        // there; the moment they scroll up, auto-scroll backs off and their
        // position is preserved (rule 1: never move the reader against intent).
        // During follow-up streams we additionally gate this on `latched`
        // (see DiscussionView): the user's question pins to the top and the
        // viewport only resumes live-edge following once they scroll back to
        // the bottom (manual "latch back on"). Initial-explainer streams keep
        // `autoScroll=true` since there is no user anchor to pin.
        autoScroll={autoScroll}
        // ponytail: 64px of the previous reply stays visible above the next
        // anchored user message — keeps the new turn visually connected to
        // what came before (rule 6: keep part of the previous conversation
        // in context).
        scrollPreviousItemPeek={64}
        // ponytail: saved discussions reopen at the last anchored turn (the
        // last user message), not the absolute bottom. Falls back to "end"
        // when no anchors exist or the last turn already fits in the viewport.
        defaultScrollPosition="last-anchor"
      >
        <ScrollLatch onChange={setLatched} />
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="px-4 py-3">
            <MessageScrollerContent className="gap-3">
              {/*
                ponytail: start-of-thread "Started from" marker — the companion
                to the mid-conversation "Added" markers. Pinned to the top
                (before the first message / explainer seed), gated on
                hasMidConvoBookAddition so it only appears when there's a
                meaningful origin-vs-added distinction to draw. Same visual as
                the "Added" rows; differentiated by wording. Clickable to jump
                to the origin book only when viewing from a co-primary (a
                click from the origin view would be a no-op).
              */}
              {hasMidConvoBookAddition && originBook && (
                <MessageScrollerItem messageId={`evt-start-${originBook.bookId}`}>
                  <TimelineEventRow
                    event={{
                      kind: "book-added",
                      createdAt: "",
                      label: originBook.title,
                      coverPath: originBook.coverPath,
                      bookId: originBook.bookId,
                    }}
                    variant="started"
                    onOpenBook={isOriginView ? undefined : onOpenBook}
                  />
                </MessageScrollerItem>
              )}
        {/* Initial explainer response */}
              {streamingInitial && phaseLabel && !initialContent && (
                <MessageScrollerItem messageId="phase-status">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {phaseLabel}
                  </div>
                </MessageScrollerItem>
              )}
              {/*
                ponytail: admin-only explainer provenance, co-located with the
                explainer message it describes — version badge, cache hit/fresh,
                newer-version note, the regenerate (re-reroll) action, and reroll
                progress, tucked just above the first message. Regular users see
                a normal chat with none of this.
              */}
              {adminMeta && !streamingInitial && (
                <MessageScrollerItem messageId="admin-meta">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5 pl-0.5 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className="h-5 gap-1 px-1.5 font-normal">
                      <Database className="h-2.5 w-2.5" />
                      Explainer · v{adminMeta.version}
                    </Badge>
                    {adminMeta.initialCacheHit === true && <span>from cache</span>}
                    {adminMeta.initialCacheHit === false && <span>freshly generated</span>}
                    {adminMeta.version < adminMeta.latestVersion && (
                      <span className="text-amber-600 dark:text-amber-500">
                        newer v{adminMeta.latestVersion} available
                      </span>
                    )}
                    {onReroll && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="h-5 w-5"
                        onClick={() => onReroll(adminMeta.explainerId)}
                        disabled={!!rerolling}
                        title="Regenerate explainer (new version)"
                        aria-label="Regenerate explainer"
                      >
                        <RefreshCw className={cn("h-3 w-3", rerolling && "animate-spin")} />
                      </Button>
                    )}
                    {(rerolling || rerollResult !== null) && (
                      <div className="w-full pt-0.5">
                        {rerolling ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {rerollPhase === "explaining"
                                ? "Explaining the book…"
                                : rerollPhase === "refining"
                                ? "Refining the explanation…"
                                : "Regenerating explainer…"}
                            </div>
                            {rerollContent && <p className="line-clamp-3">{rerollContent}</p>}
                          </div>
                        ) : (
                          <p className="text-emerald-600 dark:text-emerald-500">
                            ✓ v{rerollResult} now live for new discussions
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </MessageScrollerItem>
              )}

              {/* Initial explainer response (blank "New discussion" discussions
                  have no explainer seed — skip the bubble entirely so the
                  conversation starts at the user's own first message). */}
              {(initialContent || streamingInitial) && (
                <MessageScrollerItem messageId="explainer-seed">
                  <MessageBubble
                    role="assistant"
                    content={initialContent}
                    pulsing={streamingInitial && !initialContent}
                    spineHrefs={spineHrefs}
                    onNavigateToHref={onNavigateToHref}
                    attachedBookHrefs={attachedBookHrefs}
                    onNavigateToBookSection={onNavigateToBookSection}
                    originBookId={originBookId}
                    isAdmin={isAdmin}
                  />
                </MessageScrollerItem>
              )}

              {/*
                Follow-up messages interleaved with attachment "added" event
                markers. mergeTimeline places each mid-conversation book/
                section addition at the chronological point where it entered
                the conversation (between the bracketing turns). Turn-0
                attachments are already filtered out by the panel derivation,
                so they don't render as events (co-original).

                ponytail: every row is a MessageScrollerItem so the scroller
                can measure, anchor, preserve position, track visibility, and
                jump to it. scrollAnchor on user messages implements **new-turn
                anchoring** — when the user sends a message, the viewport moves
                it near the top and keeps a peek of the previous reply above
                it (see MessageScrollerProvider's scrollPreviousItemPeek). The
                assistant's reply rows are NOT anchors, so they grow into the
                space below without yanking the user's anchored turn.
              */}
              {mergeTimeline(messages, timelineEvents ?? []).map((slot) =>
                slot.type === "event" ? (
                  <MessageScrollerItem
                    key={`evt-${slot.event.kind}-${slot.event.createdAt}`}
                    messageId={`evt-${slot.event.kind}-${slot.event.createdAt}`}
                  >
                    <TimelineEventRow
                      event={slot.event}
                      onOpenBook={onOpenBook}
                      onNavigateToHref={onNavigateToHref}
                    />
                  </MessageScrollerItem>
                ) : (
                  <MessageScrollerItem
                    key={`msg-${slot.index}`}
                    messageId={`msg-${slot.index}`}
                    // ponytail: scrollAnchor on user messages = new-turn
                    // anchoring. The viewport pins this row near the top
                    // when it's appended, so the user sees their question
                    // and the assistant's reply grows below it.
                    scrollAnchor={slot.message.role === "user"}
                  >
                    <MessageBubble
                      role={slot.message.role}
                      content={slot.message.content}
                      pulsing={
                        slot.message.role === "assistant" &&
                        streaming &&
                        !slot.message.content &&
                        slot.index === messages.length - 1
                      }
                      spineHrefs={spineHrefs}
                      onNavigateToHref={onNavigateToHref}
                      attachedBookHrefs={attachedBookHrefs}
                      onNavigateToBookSection={onNavigateToBookSection}
                      originBookId={originBookId}
                      isAdmin={isAdmin}
                    />
                  </MessageScrollerItem>
                )
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <div className="border-t border-border p-2 flex flex-col gap-1.5">
        {/*
          ponytail: "Context" — what each follow-up includes, anchored to the
          composer. The book is always present; the originating passage
          (CFI-precise deeplink, mirroring highlights) or section (href deeplink)
          is shown when present. Flat chip row so future "add context"
          attachments drop in as siblings.
        */}
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">Context</span>
          <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5">
            This book
            {isOriginView && hasMidConvoBookAddition && <OriginalBadge />}
          </span>
          {discussionType === "passage" && discussionPassageText && (
            <button
              type="button"
              className="max-w-[12rem] truncate rounded bg-muted px-1.5 py-0.5 underline-offset-2 hover:underline disabled:no-underline"
              title={discussionPassageText}
              onClick={() =>
                discussionPassageCfi && onNavigateToCfi
                  ? onNavigateToCfi(discussionPassageCfi)
                  : discussionSectionHref && onNavigateToHref
                    ? onNavigateToHref(discussionSectionHref)
                    : undefined
              }
              disabled={!discussionPassageCfi || !onNavigateToCfi}
            >
              “{discussionPassageText.slice(0, 60)}…”
            </button>
          )}
          {discussionType === "section" && discussionSectionHref && (
            <button
              type="button"
              className="max-w-[12rem] truncate rounded bg-muted px-1.5 py-0.5 underline-offset-2 hover:underline disabled:no-underline"
              title={discussionSectionLabel || discussionSectionHref}
              onClick={() => onNavigateToHref?.(discussionSectionHref)}
              disabled={!onNavigateToHref}
            >
              {discussionSectionLabel || discussionSectionHref}
            </button>
          )}
          {/*
            ponytail: permanently-attached sections (sent in a prior turn).
            Clickable deeplink like the origin; no "x" — they are re-sent on
            every follow-up by rebuildSystemPrompt's attachment suffix.
          */}
          {(persistedAttachments ?? []).map((a) => (
            <button
              key={`p-${a.sectionHref}`}
              type="button"
              className="max-w-[12rem] truncate rounded bg-muted px-1.5 py-0.5 underline-offset-2 hover:underline disabled:no-underline"
              title={a.label}
              onClick={() => onNavigateToHref?.(a.sectionHref)}
              disabled={!onNavigateToHref}
            >
              {a.label}
            </button>
          ))}
          {/*
            ponytail: pending attachments — sent on the last turn, awaiting the
            active-discussion refetch that retires them into persistedAttachments.
            Same look as persisted (clickable deeplink, no x) so the chip holds
            steady through the stream instead of blinking out.
          */}
          {(pendingAttachments ?? []).map((a) => (
            <button
              key={`k-${a.sectionHref}`}
              type="button"
              className="max-w-[12rem] truncate rounded bg-muted px-1.5 py-0.5 underline-offset-2 hover:underline disabled:no-underline"
              title={a.label}
              onClick={() => onNavigateToHref?.(a.sectionHref)}
              disabled={!onNavigateToHref}
            >
              {a.label}
            </button>
          ))}
          {/*
            ponytail: draft attachments — picked but not yet sent. Removable
            via "x" (onRemoveDraftAttachment). On send they flip to permanent
            (persisted server-side). Cleared from draft state in sendFollowup.
          */}
          {(draftAttachments ?? []).map((a) => (
            <span
              key={`d-${a.sectionHref}`}
              className="inline-flex max-w-[12rem] items-center gap-0.5 truncate rounded bg-muted px-1.5 py-0.5"
              title={a.label}
            >
              <span className="truncate">{a.label}</span>
              {onRemoveDraftAttachment && (
                <button
                  type="button"
                  aria-label={`Remove ${a.label}`}
                  onClick={() => onRemoveDraftAttachment(a.sectionHref)}
                  className="text-muted-foreground/70 hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          {/*
            ponytail: attached "other book" chips — single slot (persisted +
            pending + draft). Persisted/pending carry no "x" (committed); the
            draft is removable until sent. Chip shows a tiny cover + title.
          */}
          {(() => {
            const chip = (
              b: BookAttachment,
              key: string,
              onRemove?: () => void,
              onClick?: () => void,
              badge?: ReactNode
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
                {badge && <span className="shrink-0">{badge}</span>}
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
            const open = (id: string) => () => onOpenBook?.(id);
            return (
              <>
                {/* ponytail: origin book chip — shown when viewing from a
                  co-primary. "This book" (above) means the open book; the
                  origin appears here as a named chip. Clickable → opens the
                  origin book at its last-read position. Wears the "Original"
                  badge only when a book was added mid-conversation (else the
                  origin and the turn-0 attached book are both co-original and
                  the label is noise). */}
                {originBookChip &&
                  chip(
                    originBookChip,
                    `ob-${originBookChip.bookId}`,
                    undefined,
                    open(originBookChip.bookId),
                    hasMidConvoBookAddition ? <OriginalBadge /> : undefined
                  )}
                {/* ponytail: hide persistedBook when it IS the current book —
                  it's already represented by "This book" and showing both is
                  redundant. Only hides the visual chip; the attachment still
                  counts toward the slot cap. Clickable → opens at last-read. */}
                {persistedBook &&
                  persistedBook.bookId !== currentBookId &&
                  chip(persistedBook, `pb-${persistedBook.bookId}`, undefined, open(persistedBook.bookId))}
                {pendingBook &&
                  pendingBook.bookId !== persistedBook?.bookId &&
                  pendingBook.bookId !== currentBookId &&
                  chip(pendingBook, `kb-${pendingBook.bookId}`, undefined, open(pendingBook.bookId))}
                {draftBook &&
                  draftBook.bookId !== persistedBook?.bookId &&
                  draftBook.bookId !== pendingBook?.bookId &&
                  draftBook.bookId !== currentBookId &&
                  chip(draftBook, "db", onRemoveDraftBook)}
              </>
            );
          })()}
          {/*
            ponytail: unified "Attach" affordance — ONE Popover whose content
            swaps between a kind chooser ("Section" / "Other book") and the
            matching searchable Command. Single floating layer by design: opening
            a second Popover from a DropdownMenu item races the menu's teardown
            (focus/pointer-event trap dismissal fires the new layer's outside
            click) and the popover vanishes instantly. When the tier disallows
            other-book attachments the trigger opens straight to the section list.
          */}
          {(() => {
            const sectionAvailable =
              !!onAddDraftAttachment && !!pickerOptions && pickerOptions.length > 0;
            const booksAvailable = bookEnabled && !!onAddDraftBook && bookSlotsRemaining > 0;
            if (!sectionAvailable && !booksAvailable && !attachOpen) return null;

            const closeAttach = () => {
              setAttachOpen(false);
              setAttachView("menu");
            };

            return (
              <Popover
                open={attachOpen}
                onOpenChange={(o) => {
                  if (o) {
                    // Opening fresh: skip the chooser when books aren't offered.
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
                        onClick={() => {
                          setBookQueryEnabled(true);
                          setAttachView("book");
                        }}
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
                          {(pickerOptions ?? []).map((s) => (
                            <CommandItem
                              key={s.href}
                              value={s.label}
                              onSelect={() => {
                                onAddDraftAttachment?.(s.href, s.label);
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
                          {((libraryData?.books as ({ id: string; title: string; author: string | null; coverPath: string | null; txtTokens: number | null })[] | undefined) ?? [])
                            .filter((b) => b.id !== currentBookId)
                            .map((b) => (
                              <CommandItem
                                key={b.id}
                                value={`${b.title} ${b.author ?? ""}`}
                                onSelect={() => {
                                  onAddDraftBook?.({
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
            );
          })()}
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={composerPlaceholder ?? "Ask a follow-up…"}
            className="text-sm min-h-[36px] max-h-[100px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          {/*
            ponytail: the composer is NEVER disabled (so the user can draft
            their next question while a response streams); the Send button
            carries the disabled state instead — busy or empty.
          */}
          <Button
            size="icon"
            onClick={onSend}
            disabled={streaming || streamingInitial || !input.trim()}
            title="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  pulsing,
  spineHrefs,
  onNavigateToHref,
  attachedBookHrefs,
  onNavigateToBookSection,
  originBookId,
  isAdmin,
}: {
  role: "user" | "assistant";
  content: string;
  pulsing?: boolean;
  spineHrefs: string[];
  onNavigateToHref?: (href: string) => void;
  attachedBookHrefs?: Record<string, string[]>;
  onNavigateToBookSection?: (bookId: string, basename: string) => void;
  originBookId?: string;
  isAdmin?: boolean;
}) {
  // ponytail: admin-only debug affordance on rendered (assistant) bubbles.
  // Toggles a raw <pre> view of the source markdown and offers a one-click
  // copy. Local state per bubble — no global debug flag needed.
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const showAdminTools = !!isAdmin && role === "assistant" && !!content;

  const copyRaw = async () => {
    try {
      await navigator.clipboard?.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable (permissions / non-secure context) — silent.
    }
  };

  return (
    <div className={cn("flex flex-col", role === "user" ? "items-end" : "items-start")}>
      <div
        className={cn(
          "group relative max-w-[85%] rounded-lg px-3 py-2 text-sm",
          role === "user"
            ? "bg-primary text-primary-foreground whitespace-pre-wrap"
            : showRaw
            ? "bg-muted border border-border"
            : "bg-muted border border-border prose prose-sm dark:prose-invert max-w-none prose-pre:my-1"
        )}
      >
        {/*
          ponytail: admin Raw/Copy float at the bubble's top-right corner so
          they share the first line of content instead of stacking as a row
          above/below. z-10 keeps them above prose content; bg transparent
          avoids clipping text underneath.
        */}
        {showAdminTools && (
          <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded bg-background/80 px-1 py-0.5 text-[10px] text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted hover:text-foreground"
              title={showRaw ? "Show rendered" : "Show raw markdown"}
            >
              <Code className="h-3 w-3" />
              {showRaw ? "Rendered" : "Raw"}
            </button>
            <button
              type="button"
              onClick={copyRaw}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted hover:text-foreground"
              title="Copy raw markdown"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        {content ? (
          role === "user" ? (
            content
          ) : showRaw ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{content}</pre>
          ) : (
            <ExplainerContent
              content={content}
              spineHrefs={spineHrefs}
              onNavigateToHref={onNavigateToHref}
              attachedBookHrefs={attachedBookHrefs}
              onNavigateToBookSection={onNavigateToBookSection}
              originBookId={originBookId}
            />
          )
        ) : pulsing ? (
          <span className="inline-flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
          </span>
        ) : (
          ""
        )}
      </div>
    </div>
  );
}

// ponytail: small inline "Original" pill — marks the discussion's origin book
// when a book was added mid-conversation. Rendered only when the distinction
// carries information (hasMidConvoBookAddition); absent otherwise.
function OriginalBadge() {
  return (
    <span className="rounded-sm border border-border bg-background px-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
      Original
    </span>
  );
}

// ponytail: a centered system-event row marking when a book or section entered
// the conversation (variant="added", placed by mergeTimeline between turns), OR
// the conversation's origin book (variant="started", pinned to the top by the
// caller). Same dashed-pill visual so they read as one provenance system; the
// wording differentiates: "Added {title}" vs "Started from {title}". Books show
// a tiny cover; sections show a FileText glyph. Clickable when a nav handler is
// available (book → onOpenBook, section → onNavigateToHref), matching the chips.
function TimelineEventRow({
  event,
  variant = "added",
  onOpenBook,
  onNavigateToHref,
}: {
  event: TimelineEvent;
  variant?: "added" | "started";
  onOpenBook?: (bookId: string) => void;
  onNavigateToHref?: (href: string) => void;
}) {
  const started = variant === "started";
  // "started" is only ever used for the origin book; "added" honors event.kind.
  const isBook = started || event.kind === "book-added";
  // ponytail: capture into consts so TS narrows through the closures below
  // (property narrowing on `event` doesn't persist into nested arrows).
  const bid = isBook ? event.bookId : undefined;
  const href = !isBook ? event.sectionHref : undefined;
  const clickable =
    (isBook && !!bid && !!onOpenBook) ||
    (!isBook && !!href && !!onNavigateToHref);
  const onClick = bid
    ? () => onOpenBook?.(bid)
    : href
      ? () => onNavigateToHref?.(href)
      : undefined;
  const prefix = started ? "Started from" : isBook ? "Added" : "Added section";
  const tooltip = started
    ? `Started from “${event.label}”`
    : isBook
      ? `Added “${event.label}” to the conversation`
      : `Added section “${event.label}”`;
  return (
    <div className="flex items-center justify-center py-0.5">
      <span
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
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
        className={
          "inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground" +
          (clickable ? " cursor-pointer hover:bg-muted hover:text-foreground" : "")
        }
        title={tooltip}
      >
        {isBook ? (
          <>
            <span className="h-3.5 w-2.5 shrink-0 overflow-hidden rounded-sm">
              <BookCover coverPath={event.coverPath} title={event.label} cover />
            </span>
            <span>{prefix}</span>
            <span className="max-w-[10rem] truncate font-medium text-foreground">{event.label}</span>
          </>
        ) : (
          <>
            <FileText className="h-3 w-3 shrink-0" />
            <span>{prefix}</span>
            <span className="max-w-[10rem] truncate font-medium text-foreground">{event.label}</span>
          </>
        )}
      </span>
    </div>
  );
}

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

// ponytail: advisory "X% full" estimate for an explainer discussion. Returns null
// when bookTxtTokens or contextWindow is missing — caller hides the indicator.
//
// Token accounting follows what rebuildSystemPrompt actually puts on the wire
// on a follow-up turn:
//   1. Full book plaintext (book.txtTokens) — the dominant term; re-sent every turn
//   2. Any attached "other book" plaintext (attachedBookTokens) — re-sent every turn
//   3. Passage focus text (discussion.passageText) — passage type only
//   4. Initial explainer response — sent as the first assistant message
//   5. All follow-up messages (user + assistant)
//   6. Current draft (so the bar moves as the user types)
//   7. EXPLAINER_TEMPLATE_TOKENS — constant scaffolding around the substitutions
//
// Known undercount: section-type discussions re-extract section text from the EPUB
// on every follow-up (not stored on the discussion), so we can't count it client-
// side. Typically 1-5% of the book — well under the template-overhead slack.
function computeContextIndicator(args: {
  bookTxtTokens?: number | null;
  contextWindow?: number;
  initialContent: string;
  messages: Message[];
  inputDraft: string;
  discussionType: DiscussionType;
  discussionPassageText: string | null;
  attachedBookTokens?: number | null;
}): { pct: number; overBudget: boolean; label: string } | null {
  const {
    bookTxtTokens,
    contextWindow,
    initialContent,
    messages,
    inputDraft,
    discussionPassageText,
    attachedBookTokens,
  } = args;
  // Hide while inputs are unresolved. bookTxtTokens === null means the lazy
  // backfill hasn't run; contextWindow === undefined/0 means the server
  // couldn't resolve the tier model. In both cases the percentage would be
  // meaningless, so we render nothing rather than mislead.
  if (typeof bookTxtTokens !== "number" || !contextWindow || contextWindow <= 0) {
    return null;
  }

  const messagesTokens = messages.reduce(
    (s, m) => s + countTokens(m.content),
    0
  );
  const usedTokens =
    bookTxtTokens +
    (attachedBookTokens ?? 0) +
    countTokens(initialContent) +
    countTokens(discussionPassageText ?? "") +
    messagesTokens +
    countTokens(inputDraft) +
    EXPLAINER_TEMPLATE_TOKENS;

  const pct = Math.min(100, (usedTokens / contextWindow) * 100);
  const overBudget = usedTokens > contextWindow * 0.9;
  const label = `~${formatTokens(usedTokens)} of ${formatTokens(contextWindow)} tokens (${Math.round(pct)}% full)`;

  return { pct, overBudget, label };
}
