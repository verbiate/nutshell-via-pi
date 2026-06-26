"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Square,
  Lightbulb,
  Loader2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Trash2,
  Database,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/use-session";
import {
  countTokens,
  formatTokens,
  EXPLAINER_TEMPLATE_TOKENS,
} from "@/lib/client-tokens";
import type { SpineItem } from "@/lib/reader/spine-playlist";
import { ExplainerContent } from "./explainer-content";
import { DiscussionLinksPanel } from "./discussion-links-panel";

// ponytail: single-file panel for the sidebar's `bulb` tool. Two views
// (list / thread) gated by `activeThreadId`. Receives `pendingPassage` from
// the parent reader-client when the user clicks "Explain this" — fires the
// create-thread API and streams the initial response into a fresh thread view.
//
// No zustand — follows codebase convention of React Query + local state.
// Streaming uses index-based message updates (lesson from playground/page.tsx:
// never compare streaming placeholders by object reference).

type ThreadType = "passage" | "section" | "book";

type ThreadPreview = {
  id: string;
  type: ThreadType;
  passageText: string | null;
  sectionHref: string | null;
  language: string;
  updatedAt: string;
  explainer: { id: string; content: string; modelId: string };
  _count: { messages: number };
};

type Message = { role: "user" | "assistant"; content: string };

// ponytail: discriminated union — one state slot for any kind of pending
// explainer request (passage/section/book). Reader-client sets it, this
// panel consumes it, parent clears it via onConsumed.
export type PendingExplainerRequest =
  | { type: "passage"; text: string; cfi: string | null }
  | { type: "section"; sectionHref: string; sectionTitle: string }
  | { type: "book" };

export interface ExplainerThreadsPanelProps {
  bookId: string;
  pendingRequest: PendingExplainerRequest | null;
  onConsumed: () => void;
  // ponytail: fired when the panel pops a thread into the modal so the parent
  // can close the sidebar (gives the modal full focus). The bulb panel stays
  // mounted via reader-sidebar.tsx's lastTool pattern, so panel state
  // (activeThreadId, streaming, poppedOut) is preserved while hidden.
  onCloseSidebar?: () => void;
  // ponytail: fired when the user "returns" the discussion from the modal
  // back to the sidebar. Parent reopens the bulb tool; the panel was never
  // unmounted (lastTool), so the active thread is still intact.
  onReturnToSidebar?: () => void;
  // ponytail: token-budget inputs for the "X% full" indicator. Both come from
  // the reader server component (resolved via tier config + getContextWindow).
  // Optional so the panel doesn't crash if a future caller omits them — the
  // bar simply doesn't render.
  bookTxtTokens?: number | null;
  contextWindow?: number;
  // ponytail: citation deep-link plumbing. spineItems is the reader's spine
  // (used to validate hrefs by basename + provided to ThreadView/MessageBubble);
  // onNavigateToHref reuses the reader's existing ToC navigation path.
  onNavigateToHref?: (href: string) => void;
  // ponytail: CFI-precise deeplink for the discussion's originating passage
  // (mirrors highlights). Falls back to section-level nav when no CFI.
  onNavigateToCfi?: (cfi: string) => void;
  spineItems?: SpineItem[];
}

export function ExplainerThreadsPanel({
  bookId,
  pendingRequest,
  onConsumed,
  onCloseSidebar,
  onReturnToSidebar,
  bookTxtTokens,
  contextWindow,
  onNavigateToHref,
  onNavigateToCfi,
  spineItems,
}: ExplainerThreadsPanelProps) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const isAdmin = ((user as any)?.role as string) === "admin";
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [threadToPurge, setThreadToPurge] = useState<ThreadPreview | null>(null);
  // ponytail: pop-out modal state. When true, the same panel view (thread or
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
  const abortRef = useRef<AbortController | null>(null);
  // ponytail: StrictMode double-fire guard for the pendingRequest effect below.
  // Holds the last-processed request reference; the effect bails if the
  // incoming request matches (same reference = same render's StrictMode re-fire).
  const lastProcessedRef = useRef<PendingExplainerRequest | null>(null);

  // List of threads for this book (sidebar list view)
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ["explainer-threads", bookId],
    queryFn: async () => {
      const res = await fetch(`/api/explainers/threads?bookId=${bookId}`);
      if (!res.ok) throw new Error("Failed to load threads");
      return res.json();
    },
  });
  const threads: ThreadPreview[] = listData?.threads ?? [];

  // Active thread content + messages
  const { data: activeData } = useQuery({
    queryKey: ["explainer-thread", activeThreadId],
    queryFn: async () => {
      const res = await fetch(`/api/explainers/threads/${activeThreadId}`);
      if (!res.ok) throw new Error("Failed to load thread");
      return res.json();
    },
    enabled: !!activeThreadId,
  });

  // Local copy of messages so we can stream chunks into the last assistant
  // message without re-fetching.
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [initialContent, setInitialContent] = useState<string>("");
  const [streamingInitial, setStreamingInitial] = useState(false);
  // ponytail: two-pass progress phase (null for one-pass / after completion).
  // Drives a "Explaining…" / "Refining…" label during pass 1's silent window.
  const [phase, setPhase] = useState<"explaining" | "refining" | null>(null);

  // ponytail: when activeThreadId changes (or active data loads), reset local
  // state from server truth. This is the only place setState is called in an
  // effect intentionally — we want to sync from server when the thread changes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (activeData?.thread) {
      setInitialContent(activeData.thread.explainer.content);
      setLocalMessages(
        activeData.thread.messages
          ?.filter((m: any) => m.role === "user" || m.role === "assistant")
          .map((m: any) => ({ role: m.role, content: m.content })) ?? []
      );
    }
  }, [activeData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Handle a new pending passage from the parent (user clicked "Explain this")
  // ponytail: defined after startPassageThread below to satisfy declaration order.
  // (See effect placement at bottom of this section.)

  const startThread = useCallback(
    async (request: PendingExplainerRequest) => {
      // Reset state for the new thread
      setActiveThreadId(null);
      setInitialContent("");
      setLocalMessages([]);
      setStreamingInitial(true);
      setStreaming(true);
      setPhase(null);

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = "";
      let newThreadId: string | null = null;

      // Build POST body from the discriminated union
      const body: Record<string, unknown> = { bookId, type: request.type };
      if (request.type === "passage") {
        body.passageText = request.text;
        body.passageCfi = request.cfi;
      } else if (request.type === "section") {
        body.sectionHref = request.sectionHref;
      }

      try {
        const res = await fetch("/api/explainers/threads", {
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
                console.error("Thread creation failed:", parsed.error);
                setStreamingInitial(false);
                setStreaming(false);
                setPhase(null);
                return;
              }
              if (parsed.type === "status" && parsed.stage) {
                setPhase(parsed.stage as "explaining" | "refining");
              }
              if (parsed.type === "existing" && parsed.threadId) {
                // ponytail: user already has a discussion for this context —
                // reopen it instead of regenerating. Just navigate; the active-
                // thread query loads its content.
                newThreadId = parsed.threadId;
                break;
              }
              if (parsed.type === "chunk" && parsed.chunk) {
                accumulated += parsed.chunk;
                setInitialContent(accumulated);
              }
              if (parsed.type === "thread" && parsed.threadId) {
                newThreadId = parsed.threadId;
              }
            } catch {
              // Skip malformed lines
            }
          }
        }

        // Invalidate the list so the new thread appears
        queryClient.invalidateQueries({ queryKey: ["explainer-threads", bookId] });

        // Set the active thread id so the active-thread query fires and
        // populates messages from server truth.
        if (newThreadId) {
          setActiveThreadId(newThreadId);
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("Initial thread stream failed:", err);
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
    startThread(pendingRequest);
    onConsumed();
  }, [pendingRequest, startThread, onConsumed]);

  function selectThread(id: string) {
    if (streaming) return;
    setActiveThreadId(id);
    setInitialContent("");
    setLocalMessages([]);
  }

  function backToList() {
    if (streaming) return;
    setActiveThreadId(null);
    setInitialContent("");
    setLocalMessages([]);
  }

  // ponytail: pop a thread into the modal. Called from ThreadView's header
  // expand button (no id — keep the current thread) or ListView's per-row ⋯
  // menu (id given — select first, then open). Selecting from the list only
  // happens when no thread is active, so selectThread's `if (streaming) return`
  // guard can't fire here. Closes the sidebar so the modal gets full focus —
  // the bulb panel stays mounted (reader-sidebar lastTool), preserving state.
  function popOutThread(id?: string) {
    if (id) selectThread(id);
    setPoppedOut(true);
    onCloseSidebar?.();
  }

  // ponytail: inverse of popOutThread — close the modal and reopen the
  // sidebar. The active thread survives because the bulb panel never
  // unmounted (reader-sidebar lastTool keeps it alive while hidden).
  function returnToSidebar() {
    setPoppedOut(false);
    onReturnToSidebar?.();
  }

  // ponytail: wrap navigation so a citation jump from the panel OR an inline
  // link also closes the pop-out modal, revealing the reader. Built only when
  // the parent supplied onNavigateToHref; passed down to ThreadView so both
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

  // ─── Follow-up composer ─────────────────────────────────────────────────
  const [input, setInput] = useState("");

  async function sendFollowup() {
    const text = input.trim();
    if (!text || streaming || !activeThreadId) return;

    // ponytail: index-based update — append placeholder assistant message
    // and update by index during streaming. Object-reference equality fails
    // after the first chunk update (see playground bug from earlier session).
    const assistantIndex = localMessages.length + 1;
    const nextMessages = [...localMessages, { role: "user" as const, content: text }];
    setLocalMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(
        `/api/explainers/threads/${activeThreadId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
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
      queryClient.invalidateQueries({ queryKey: ["explainer-threads", bookId] });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("Follow-up fetch failed:", err);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function handleDeleteThread(id: string) {
    try {
      const res = await fetch(`/api/explainers/threads/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        queryClient.invalidateQueries({
          queryKey: ["explainer-threads", bookId],
        });
        if (id === activeThreadId) backToList();
      } else {
        console.error(
          "[ExplainerThreadsPanel] delete thread failed:",
          res.status
        );
      }
    } catch (err) {
      console.error("[ExplainerThreadsPanel] delete thread failed:", err);
    }
  }

  async function handlePurgeCache(thread: ThreadPreview) {
    try {
      const res = await fetch(`/api/explainers/${thread.explainer.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        queryClient.invalidateQueries({
          queryKey: ["explainer-threads", bookId],
        });
        setThreadToPurge(null);
        if (thread.id === activeThreadId) backToList();
      } else {
        console.error(
          "[ExplainerThreadsPanel] purge cache failed:",
          res.status
        );
      }
    } catch (err) {
      console.error("[ExplainerThreadsPanel] purge cache failed:", err);
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
      // Refresh latestVersion on the active thread so the "newer version"
      // indicator updates immediately.
      queryClient.invalidateQueries({
        queryKey: ["explainer-thread", activeThreadId],
      });
    } catch (err) {
      console.error("[reroll] failed:", err);
    } finally {
      setRerolling(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  // ponytail: during initial stream, activeData isn't loaded yet — derive the
  // thread type + passage text from the pendingRequest so the indicator can
  // render meaningfully before the server roundtrip completes.
  const activeThread = activeData?.thread as
    | {
        type?: ThreadType;
        passageText?: string | null;
        passageCfi?: string | null;
        sectionHref?: string | null;
        initialCacheHit?: boolean | null;
        latestVersion?: number;
        explainer?: { id?: string; version?: number };
      }
    | undefined;
  const threadType: ThreadType =
    activeThread?.type ?? pendingRequest?.type ?? "book";
  const threadPassageText: string | null =
    activeThread?.passageText ??
    (pendingRequest?.type === "passage" ? pendingRequest.text : null) ??
    null;
  const threadPassageCfi: string | null = activeThread?.passageCfi ?? null;
  const threadSectionHref: string | null = activeThread?.sectionHref ?? null;
  // ponytail: admin-only metadata for the explainer badge / cache chip /
  // newer-version indicator / regenerate action.
  const adminMeta =
    isAdmin && activeThread?.explainer
      ? {
          explainerId: activeThread.explainer.id!,
          version: activeThread.explainer.version ?? 1,
          latestVersion: activeThread.latestVersion ?? activeThread.explainer.version ?? 1,
          initialCacheHit: activeThread.initialCacheHit ?? null,
        }
      : undefined;

  // ponytail: single render fn feeds both the sidebar slot and the pop-out
  // Dialog. State lives in this panel, so both views stay in sync by
  // construction. `inModal` flips the header's expand button off (redundant
  // inside the modal) and reserves room for the Dialog's X close button.
  // Plain function (not useCallback) — closes over fresh state every render,
  // and no memoized child needs a stable reference.
  function renderPanelContent(inModal: boolean) {
    if (activeThreadId || streamingInitial) {
      return (
        <ThreadView
          initialContent={initialContent}
          streamingInitial={streamingInitial}
          phase={phase}
          messages={localMessages}
          input={input}
          setInput={setInput}
          streaming={streaming}
          onSend={sendFollowup}
          onStop={stop}
          onBack={backToList}
          threadType={threadType}
          threadPassageText={threadPassageText}
          threadPassageCfi={threadPassageCfi}
          threadSectionHref={threadSectionHref}
          bookTxtTokens={bookTxtTokens}
          contextWindow={contextWindow}
          inModal={inModal}
          onPopOut={() => popOutThread()}
          onReturnToSidebar={returnToSidebar}
          onNavigateToHref={navigateAndCloseModal}
          onNavigateToCfi={navigateCfiAndCloseModal}
          spineItems={spineItems}
          adminMeta={adminMeta}
          onReroll={handleReroll}
          rerolling={rerolling}
          rerollContent={rerollContent}
          rerollPhase={rerollPhase}
          rerollResult={rerollResult}
        />
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-9">
        <div className="px-12">
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => startThread({ type: "book" })}
            disabled={streaming}
          >
            <Lightbulb />
            New discussion
          </Button>
        </div>
        <ListView
          threads={threads}
          loading={listLoading}
          onSelect={selectThread}
          onPopOut={popOutThread}
          onDelete={handleDeleteThread}
          onPurge={setThreadToPurge}
          isAdmin={isAdmin}
          emptyHint="Start a 'New discussion' about the whole book, or select text and click 'Ask about this' for a passage."
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
            visible header inside ThreadView already says "Discussion"; this
            sr-only title satisfies the a11y requirement without duplicating
            visible text.
          */}
          <DialogTitle className="sr-only">Discussion</DialogTitle>
          {renderPanelContent(true)}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!threadToPurge}
        onOpenChange={(open) => !open && setThreadToPurge(null)}
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
            <AlertDialogCancel onClick={() => setThreadToPurge(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => threadToPurge && handlePurgeCache(threadToPurge)}
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
  threads,
  loading,
  onSelect,
  onPopOut,
  onDelete,
  onPurge,
  isAdmin,
  emptyHint,
}: {
  threads: ThreadPreview[];
  loading: boolean;
  onSelect: (id: string) => void;
  onPopOut: (id: string) => void;
  onDelete: (id: string) => void;
  onPurge: (thread: ThreadPreview) => void;
  isAdmin: boolean;
  emptyHint: string;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (threads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
        <Lightbulb className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm font-medium text-foreground">No discussions yet</p>
        <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }
  return (
    // ponytail: flex-1 + min-h-0 + overflow-y-auto so the list scrolls
    // internally when it outgrows the panel (parent is min-h-0 flex-1 flex-col
    // — see reader-sidebar.tsx — so heights propagate). Without min-h-0 the
    // flex child won't actually constrain, and overflow-y-auto won't kick in.
    <div className="flex-1 min-h-0 overflow-y-auto py-2">
      <p className="px-4 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Discussions
      </p>
      <ul className="space-y-1">
        {threads.map((t) => (
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
                  ? t.sectionHref
                  : "Whole book"}
              </p>
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
                  {isAdmin && (
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
  );
}

function ThreadView({
  initialContent,
  streamingInitial,
  phase,
  messages,
  input,
  setInput,
  streaming,
  onSend,
  onStop,
  onBack,
  threadType,
  threadPassageText,
  threadPassageCfi,
  threadSectionHref,
  bookTxtTokens,
  contextWindow,
  inModal,
  onPopOut,
  onReturnToSidebar,
  onNavigateToHref,
  onNavigateToCfi,
  spineItems,
  adminMeta,
  onReroll,
  rerolling,
  rerollContent,
  rerollPhase,
  rerollResult,
}: {
  initialContent: string;
  streamingInitial: boolean;
  phase: "explaining" | "refining" | null;
  messages: Message[];
  input: string;
  setInput: (v: string) => void;
  streaming: boolean;
  onSend: () => void;
  onStop: () => void;
  onBack: () => void;
  threadType: ThreadType;
  threadPassageText: string | null;
  threadPassageCfi?: string | null;
  threadSectionHref?: string | null;
  bookTxtTokens?: number | null;
  contextWindow?: number;
  inModal?: boolean;
  onPopOut: () => void;
  onReturnToSidebar: () => void;
  onNavigateToHref?: (href: string) => void;
  onNavigateToCfi?: (cfi: string) => void;
  spineItems?: SpineItem[];
  adminMeta?: {
    explainerId: string;
    version: number;
    latestVersion: number;
    initialCacheHit: boolean | null;
  };
  onReroll?: (explainerId: string) => void;
  rerolling?: boolean;
  rerollContent?: string;
  rerollPhase?: "explaining" | "refining" | null;
  rerollResult?: number | null;
}) {
  const spineHrefs = (spineItems ?? []).map((s) => s.href);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [initialContent, messages]);

  // ponytail: autofocus the composer when rendered in the pop-out modal.
  // Covers both cases: modal opens while idle (focus immediately), and modal
  // opens during streaming (effect re-fires when streaming ends → focus then).
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (inModal && !streaming && !streamingInitial) {
      inputRef.current?.focus();
    }
  }, [inModal, streaming, streamingInitial]);

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
  // (see rebuildSystemPrompt in explainer-threads.ts). Also counts the
  // passage focus text (passage threads), the initial explainer response
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
    threadType,
    threadPassageText,
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
            ponytail: Maximize2 pops the thread into the modal (sidebar only);
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

      <DiscussionLinksPanel
        texts={[initialContent, ...messages.map((m) => m.content)]}
        spineItems={spineItems ?? []}
        onNavigateToHref={onNavigateToHref}
      />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Initial explainer response */}
        {streamingInitial && phaseLabel && !initialContent && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {phaseLabel}
          </div>
        )}
        {/*
          ponytail: admin-only explainer provenance, co-located with the
          explainer message it describes — version badge, cache hit/fresh,
          newer-version note, the regenerate (re-reroll) action, and reroll
          progress, tucked just above the first message. Regular users see a
          normal chat with none of this.
        */}
        {adminMeta && !streamingInitial && (
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
        )}

        <MessageBubble
          role="assistant"
          content={initialContent}
          pulsing={streamingInitial && !initialContent}
          spineHrefs={spineHrefs}
          onNavigateToHref={onNavigateToHref}
        />

        {/* Follow-up messages */}
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            role={m.role}
            content={m.content}
            pulsing={m.role === "assistant" && streaming && !m.content && i === messages.length - 1}
            spineHrefs={spineHrefs}
            onNavigateToHref={onNavigateToHref}
          />
        ))}
      </div>

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
          <span className="rounded bg-muted px-1.5 py-0.5">This book</span>
          {threadType === "passage" && threadPassageText && (
            <button
              type="button"
              className="max-w-[12rem] truncate rounded bg-muted px-1.5 py-0.5 underline-offset-2 hover:underline disabled:no-underline"
              title={threadPassageText}
              onClick={() =>
                threadPassageCfi && onNavigateToCfi
                  ? onNavigateToCfi(threadPassageCfi)
                  : threadSectionHref && onNavigateToHref
                    ? onNavigateToHref(threadSectionHref)
                    : undefined
              }
              disabled={!threadPassageCfi || !onNavigateToCfi}
            >
              “{threadPassageText.slice(0, 60)}…”
            </button>
          )}
          {threadType === "section" && threadSectionHref && (
            <button
              type="button"
              className="max-w-[12rem] truncate rounded bg-muted px-1.5 py-0.5 underline-offset-2 hover:underline disabled:no-underline"
              title={threadSectionHref}
              onClick={() => onNavigateToHref?.(threadSectionHref)}
              disabled={!onNavigateToHref}
            >
              {threadSectionHref}
            </button>
          )}
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a follow-up…"
            className="text-sm min-h-[36px] max-h-[100px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            disabled={streaming || streamingInitial}
          />
          {streaming ? (
            <Button size="icon" variant="outline" onClick={onStop} title="Stop">
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={onSend}
              disabled={!input.trim() || streamingInitial}
              title="Send"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
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
}: {
  role: "user" | "assistant";
  content: string;
  pulsing?: boolean;
  spineHrefs: string[];
  onNavigateToHref?: (href: string) => void;
}) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
          role === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-muted border border-border"
        )}
      >
        {content ? (
          <ExplainerContent
            content={content}
            spineHrefs={spineHrefs}
            onNavigateToHref={onNavigateToHref}
          />
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

// ponytail: advisory "X% full" estimate for an explainer thread. Returns null
// when bookTxtTokens or contextWindow is missing — caller hides the indicator.
//
// Token accounting follows what rebuildSystemPrompt actually puts on the wire
// on a follow-up turn:
//   1. Full book plaintext (book.txtTokens) — the dominant term; re-sent every turn
//   2. Passage focus text (thread.passageText) — passage type only
//   3. Initial explainer response — sent as the first assistant message
//   4. All follow-up messages (user + assistant)
//   5. Current draft (so the bar moves as the user types)
//   6. EXPLAINER_TEMPLATE_TOKENS — constant scaffolding around the substitutions
//
// Known undercount: section-type threads re-extract section text from the EPUB
// on every follow-up (not stored on the thread), so we can't count it client-
// side. Typically 1-5% of the book — well under the template-overhead slack.
function computeContextIndicator(args: {
  bookTxtTokens?: number | null;
  contextWindow?: number;
  initialContent: string;
  messages: Message[];
  inputDraft: string;
  threadType: ThreadType;
  threadPassageText: string | null;
}): { pct: number; overBudget: boolean; label: string } | null {
  const {
    bookTxtTokens,
    contextWindow,
    initialContent,
    messages,
    inputDraft,
    threadPassageText,
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
    countTokens(initialContent) +
    countTokens(threadPassageText ?? "") +
    messagesTokens +
    countTokens(inputDraft) +
    EXPLAINER_TEMPLATE_TOKENS;

  const pct = Math.min(100, (usedTokens / contextWindow) * 100);
  const overBudget = usedTokens > contextWindow * 0.9;
  const label = `~${formatTokens(usedTokens)} of ${formatTokens(contextWindow)} tokens (${Math.round(pct)}% full)`;

  return { pct, overBudget, label };
}
