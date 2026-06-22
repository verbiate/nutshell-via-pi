"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Send, Square, Lightbulb, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
  explainer: { content: string; modelId: string };
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
}

export function ExplainerThreadsPanel({
  bookId,
  pendingRequest,
  onConsumed,
}: ExplainerThreadsPanelProps) {
  const queryClient = useQueryClient();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
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
                return;
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
        abortRef.current = null;
      }
    },
    [bookId, queryClient]
  );

  // Handle a new pending request from the parent (user clicked an "ask about"
  // affordance — floating toolbar, ToC dropdown, or "Ask the book").
  // ponytail: setState-in-effect is intentional — startThread resets state
  // synchronously before its first await, which is what we want when a new
  // request arrives. The dep is `pendingRequest` (parent-controlled), not any
  // of the state being set, so no cascading renders possible.
  // lastProcessedRef guards against React StrictMode's double-fire in dev:
  // both fires pass the SAME pendingRequest reference (state hasn't propagated
  // between them), so the ref check suppresses the duplicate POST. A new click
  // creates a new object reference, so legit back-to-back requests still fire.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!pendingRequest) return;
    if (lastProcessedRef.current === pendingRequest) return;
    lastProcessedRef.current = pendingRequest;
    startThread(pendingRequest);
    onConsumed();
  }, [pendingRequest, startThread, onConsumed]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  // ─── Render ─────────────────────────────────────────────────────────────
  if (activeThreadId || streamingInitial) {
    return (
      <ThreadView
        initialContent={initialContent}
        streamingInitial={streamingInitial}
        messages={localMessages}
        input={input}
        setInput={setInput}
        streaming={streaming}
        onSend={sendFollowup}
        onStop={stop}
        onBack={backToList}
      />
    );
  }

  return (
    <ListView
      threads={threads}
      loading={listLoading}
      onSelect={selectThread}
      emptyHint="Select text in the book and click 'Explain this' to start a discussion."
    />
  );
}

// ─── Sub-components (same file, ponytail) ──────────────────────────────────

function ListView({
  threads,
  loading,
  onSelect,
  emptyHint,
}: {
  threads: ThreadPreview[];
  loading: boolean;
  onSelect: (id: string) => void;
  emptyHint: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (threads.length === 0) {
    return (
      <div className="px-6 py-8 text-center">
        <Lightbulb className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm font-medium text-foreground">No discussions yet</p>
        <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }
  return (
    <div className="py-2">
      <p className="px-4 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Discussions
      </p>
      <ul className="space-y-1">
        {threads.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              className="w-full text-left px-4 py-2 hover:bg-muted/50 rounded-none"
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Lightbulb className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground capitalize">
                  {t.type}
                </span>
                {t._count.messages > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">
                    {t._count.messages}
                  </Badge>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {formatRelative(t.updatedAt)}
                </span>
              </div>
              <p className="text-xs text-foreground line-clamp-2">
                {t.passageText
                  ? t.passageText.slice(0, 120)
                  : t.sectionHref
                  ? t.sectionHref
                  : "Whole book"}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ThreadView({
  initialContent,
  streamingInitial,
  messages,
  input,
  setInput,
  streaming,
  onSend,
  onStop,
  onBack,
}: {
  initialContent: string;
  streamingInitial: boolean;
  messages: Message[];
  input: string;
  setInput: (v: string) => void;
  streaming: boolean;
  onSend: () => void;
  onStop: () => void;
  onBack: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [initialContent, messages]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-2 border-b border-border flex items-center gap-2">
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
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Initial explainer response */}
        <MessageBubble
          role="assistant"
          content={initialContent}
          pulsing={streamingInitial && !initialContent}
        />

        {/* Follow-up messages */}
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            role={m.role}
            content={m.content}
            pulsing={m.role === "assistant" && streaming && !m.content && i === messages.length - 1}
          />
        ))}
      </div>

      <div className="border-t border-border p-2 flex items-end gap-2">
        <Textarea
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
  );
}

function MessageBubble({
  role,
  content,
  pulsing,
}: {
  role: "user" | "assistant";
  content: string;
  pulsing?: boolean;
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
        {content || (pulsing ? (
          <span className="inline-flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
          </span>
        ) : "")}
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
