"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { countTokens as _countTokens } from "gpt-tokenizer/encoding/cl100k_base";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Send, Square, Trash2, Save, RotateCcw, ChevronDown, ChevronUp,
  BookPlus, X, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ponytail: same encoding as the server (src/server/services/tokens.ts). cl100k_base
// is the de-facto approximation across GPT/Claude/Llama/Gemini English.
function countTokens(text: string): number {
  if (!text) return 0;
  return _countTokens(text);
}

// ponytail: strip OpenRouter variant suffixes (:nitro, :thinking, etc.) —
// matches the server-side model-info lookup. Mirrors route logic so local
// table hits and remote fetches agree.
function stripVariant(slug: string): string {
  const colonIdx = slug.indexOf(":");
  return colonIdx > 0 ? slug.slice(0, colonIdx) : slug;
}

type Tier = "regular" | "pro" | "admin";

const TIERS: { key: Tier; label: string }[] = [
  { key: "regular", label: "Regular" },
  { key: "pro", label: "Pro" },
  { key: "admin", label: "Admin" },
];

type ChatMessage = { role: "user" | "assistant"; content: string };

type OpenRouterConfig = {
  userType: string;
  model: string | null;
};

type SelectedBook = {
  id: string;
  title: string;
  author: string | null;
  txtTokens: number | null; // null = not yet computed (lazy backfill pending)
};

// ponytail: instant local lookup for common models; misses hit /api/admin/playground/model-info
// which proxies OpenRouter with a 24h server cache. Add entries here as needed.
const CONTEXT_WINDOWS: Record<string, number> = {
  "google/gemini-2.0-flash-001": 1_048_576,
  "google/gemini-2.5-flash": 1_048_576,
  "google/gemini-flash-1.5": 1_000_000,
  "anthropic/claude-sonnet-4.6": 200_000,
  "anthropic/claude-sonnet-4.5": 200_000,
  "anthropic/claude-3.5-sonnet": 200_000,
  "anthropic/claude-3-5-sonnet": 200_000,
  "anthropic/claude-3-opus": 200_000,
  "anthropic/claude-haiku-4.5": 200_000,
  "openai/gpt-4o": 128_000,
  "openai/gpt-4o-mini": 128_000,
  "openai/gpt-4-turbo": 128_000,
  "openai/gpt-4": 8_192,
  "meta-llama/llama-3.1-405b-instruct": 128_000,
};

const FALLBACK_CONTEXT_WINDOW = 120_000;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export default function PlaygroundPage() {
  const queryClient = useQueryClient();

  // --- Config (tier → model map) ---
  const { data: configData } = useQuery({
    queryKey: ["admin-config", "openrouter"],
    queryFn: async () => {
      const res = await fetch("/api/admin/config?category=openrouter");
      if (!res.ok) throw new Error("Failed to load OpenRouter config");
      return res.json();
    },
  });
  const configs: OpenRouterConfig[] = configData?.configs ?? [];
  const modelForTier = (t: Tier) =>
    configs.find((c) => c.userType === t)?.model ?? null;

  // --- System prompt: saved vs working copy ---
  const { data: promptData } = useQuery({
    queryKey: ["admin-system-prompt"],
    queryFn: async () => {
      const res = await fetch("/api/admin/system-prompt");
      if (!res.ok) throw new Error("Failed to load system prompt");
      return res.json();
    },
  });
  const savedPrompt: string | null = promptData?.prompt ?? null;
  const [systemPrompt, setSystemPrompt] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  // ponytail: hydrate working copy once after first read of savedPrompt. Avoids
  // clobbering edits if the query refetches, and avoids a permanent dirty state
  // from the empty-string default. Ref tracks "have we seeded yet".
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && promptData) {
      setSystemPrompt(savedPrompt ?? "");
      seededRef.current = true;
    }
  }, [promptData, savedPrompt]);

  const promptDirty = systemPrompt !== (savedPrompt ?? "");

  const savePromptMutation = useMutation({
    mutationFn: async (value: string) => {
      const res = await fetch("/api/admin/system-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: value || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-system-prompt"] });
      toast.success("System prompt saved");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Save failed");
    },
  });

  // --- Chat state ---
  const [tier, setTier] = useState<Tier>("admin");
  const [customModel, setCustomModel] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Selected books (context) ---
  const [selectedBooks, setSelectedBooks] = useState<SelectedBook[]>([]);
  const [bookModalOpen, setBookModalOpen] = useState(false);

  const activeModel = customModel.trim() || modelForTier(tier) || null;
  const activeModelLabel = activeModel ?? "(not configured)";

  // --- Context window for the active model ---
  // ponytail: local lookup is computed during render (pure). Remote fetch is
  // done in an effect that only calls setState from async callbacks, never
  // synchronously — avoids cascading renders.
  const localLookup = activeModel
    ? CONTEXT_WINDOWS[stripVariant(activeModel)]
    : undefined;
  const [remote, setRemote] = useState<{
    model: string;
    window: number;
    source: "cache" | "fetch" | "fallback";
  } | null>(null);

  useEffect(() => {
    if (!activeModel || localLookup) return;
    let cancelled = false;
    fetch(
      `/api/admin/playground/model-info?model=${encodeURIComponent(activeModel)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setRemote({
          model: activeModel,
          window: data.contextLength,
          source: data.source ?? "fetch",
        });
      })
      .catch(() => {
        if (cancelled) return;
        setRemote({
          model: activeModel,
          window: FALLBACK_CONTEXT_WINDOW,
          source: "fallback",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeModel, localLookup]);

  const contextWindow =
    localLookup ??
    (remote?.model === activeModel ? remote.window : FALLBACK_CONTEXT_WINDOW);
  const contextSource: "lookup" | "cache" | "fetch" | "fallback" | "loading" =
    localLookup ? "lookup" : remote?.model === activeModel ? remote.source : "loading";

  // ponytail: switching tier or customModel invalidates the conversation — the
  // prior turns were against a different model/context, so keeping them would
  // mislead. Cleared in the change handlers directly. Books persist across
  // tier/model changes (they're an admin-level selection, model-independent).
  function changeTier(t: Tier) {
    if (t === tier) return;
    setTier(t);
    setMessages([]);
  }
  function changeCustomModel(v: string) {
    if (v === customModel) return;
    setCustomModel(v);
    setMessages([]);
  }

  // Adding/removing books invalidates the conversation for the same reason.
  function addBooks(books: SelectedBook[]) {
    if (books.length === 0) return;
    setSelectedBooks((prev) => {
      const existing = new Set(prev.map((b) => b.id));
      return [...prev, ...books.filter((b) => !existing.has(b.id))];
    });
    setMessages([]);

    // ponytail: lazy backfill — fire-and-forget POST for any book without a
    // stored token count. Updates the chip's count in-place when resolved.
    // Surface errors so a failed backfill isn't a silent mystery.
    for (const book of books) {
      if (book.txtTokens === null) {
        toast.info(`Computing tokens for "${book.title}"…`);
        fetch(`/api/admin/books/${book.id}/tokenize`, { method: "POST" })
          .then(async (r) => {
            if (!r.ok) {
              const err = await r.json().catch(() => ({}));
              throw new Error(err.error || `Backfill failed (${r.status})`);
            }
            return r.json();
          })
          .then((data) => {
            if (typeof data.txtTokens === "number") {
              setSelectedBooks((prev) =>
                prev.map((b) =>
                  b.id === book.id ? { ...b, txtTokens: data.txtTokens } : b
                )
              );
              toast.success(`"${book.title}": ~${formatTokens(data.txtTokens)} tokens`);
            }
          })
          .catch((err) => {
            toast.error(`Tokenizing "${book.title}" failed: ${err.message}`);
          });
      }
    }
  }
  function removeBook(id: string) {
    setSelectedBooks((prev) => prev.filter((b) => b.id !== id));
    setMessages([]);
  }

  // Token estimates for the indicator.
  // Books: real BPE count from DB (cl100k_base), computed at upload or
  // lazy-backfilled on first selection. Null = still computing.
  // Chat: client-side BPE on systemPrompt + every message + the input draft.
  // ponytail: per-piece encode (not joined) — matches how the API actually
  // counts message boundaries; ~4 tokens of per-message overhead ignored.
  const bookTokens = selectedBooks.reduce(
    (s, b) => s + (b.txtTokens ?? 0),
    0
  );
  const booksLoading = selectedBooks.some((b) => b.txtTokens === null);
  const chatTokens =
    countTokens(systemPrompt) +
    messages.reduce((s, m) => s + countTokens(m.content), 0) +
    countTokens(input);
  const usedTokens = bookTokens + chatTokens;
  const window = contextWindow ?? FALLBACK_CONTEXT_WINDOW;
  const pct = window > 0 ? Math.min(100, (usedTokens / window) * 100) : 0;
  const overBudget = usedTokens > window * 0.9;

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    if (!activeModel) {
      toast.error(`No model configured for ${tier} tier`);
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: text };
    // ponytail: index-based update, NOT object-reference equality. The original
    // `m === assistantMsg` pattern silently dropped chunks after the first one —
    // the first update replaced the placeholder object, so subsequent chunks'
    // reference comparison failed and never wrote again.
    const assistantIndex = messages.length + 1;
    const nextMessages = [...messages, userMsg];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/admin/playground/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          model: customModel.trim() || undefined,
          systemPrompt: systemPrompt.trim() || undefined,
          bookIds: selectedBooks.length > 0 ? selectedBooks.map((b) => b.id) : undefined,
          // ponytail: don't send the empty assistant placeholder — OpenRouter
          // only wants the prior turns + the new user message.
          messages: nextMessages,
        }),
        signal: controller.signal,
      });

      if (!res.body) {
        toast.error("No response stream");
        return;
      }

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
            if (parsed.error) {
              toast.error(parsed.error);
              // ponytail: drop the empty assistant placeholder on error so the
              // UI doesn't show an empty bubble.
              setMessages((prev) =>
                prev.filter((_, i) => i !== assistantIndex)
              );
              // Auto-remove a book that's been deleted from the library
              const notFoundMatch = parsed.error.match(/Book not found: (.+)/);
              if (notFoundMatch) {
                setSelectedBooks((prev) => prev.filter((b) => b.id !== notFoundMatch[1]));
              }
              return;
            }
            if (parsed.chunk) {
              acc += parsed.chunk;
              const snapshot = acc;
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIndex ? { ...m, content: snapshot } : m
                )
              );
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // Keep partial assistant message — intentional abort
      } else {
        toast.error(err?.message || "Chat failed");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clearChat() {
    if (streaming) abortRef.current?.abort();
    setMessages([]);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <h1 className="text-[20px] font-semibold text-foreground">Playground</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Test OpenRouter models against the Admin-tier API key
      </p>

      {/* Config bar: tier toggle + model badge + custom model override */}
      <Card className="mt-4 p-3">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Tier (model only)</Label>
            <div className="flex gap-1">
              {TIERS.map((t) => (
                <Button
                  key={t.key}
                  size="sm"
                  variant={tier === t.key ? "default" : "outline"}
                  onClick={() => changeTier(t.key)}
                  disabled={streaming}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Active model</Label>
            <div className="h-9 flex items-center">
              <Badge variant="secondary">{activeModelLabel}</Badge>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Custom model (overrides tier; uses Admin key)
            </Label>
            <Input
              type="text"
              value={customModel}
              onChange={(e) => changeCustomModel(e.target.value)}
              placeholder="e.g. openai/gpt-4o"
              className="text-sm"
              disabled={streaming}
            />
          </div>
        </div>
      </Card>

      {/* Book context bar */}
      <Card className="mt-3 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">
            Books in context ({selectedBooks.length})
          </Label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBookModalOpen(true)}
            disabled={streaming}
          >
            <BookPlus className="h-3.5 w-3.5 mr-1" />
            Add book
          </Button>
        </div>
        {selectedBooks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedBooks.map((b) => (
              <Badge
                key={b.id}
                variant="secondary"
                className="pr-1 pl-2 py-1 gap-1"
              >
                <span className="truncate max-w-[180px]">{b.title}</span>
                <span className="text-[10px] text-muted-foreground">
                  {b.txtTokens === null
                    ? "…"
                    : `~${formatTokens(b.txtTokens)}`}
                </span>
                <button
                  type="button"
                  onClick={() => removeBook(b.id)}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        {/* Context-window indicator: always visible */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Context: ~{formatTokens(usedTokens)}
              {booksLoading && " + pending"}
              {" / "}
              {formatTokens(window)}
              {contextSource === "loading" && " (loading)"}
              {contextSource === "fallback" && " (assumed)"}
            </span>
            <span>{Math.round(pct)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                overBudget ? "bg-destructive" : "bg-primary"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </Card>

      {/* System prompt panel */}
      <Card className="mt-3">
        <button
          type="button"
          onClick={() => setPromptOpen((v) => !v)}
          className="w-full flex items-center justify-between p-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">System prompt</span>
            {promptDirty && (
              <Badge variant="outline" className="text-[10px]">Unsaved</Badge>
            )}
            {!promptDirty && savedPrompt && (
              <Badge variant="secondary" className="text-[10px]">Saved</Badge>
            )}
          </div>
          {promptOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {promptOpen && (
          <div className="px-3 pb-3 space-y-2">
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Empty = no system message sent. Type to audition, Save as live to persist."
              className="text-sm min-h-[80px]"
              disabled={streaming}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => savePromptMutation.mutate(systemPrompt)}
                disabled={!promptDirty || savePromptMutation.isPending}
              >
                <Save className="h-3.5 w-3.5 mr-1" />
                Save as live
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSystemPrompt(savedPrompt ?? "")}
                disabled={!promptDirty || savePromptMutation.isPending}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Revert
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Chat area */}
      <div
        ref={scrollRef}
        className="mt-3 flex-1 min-h-0 overflow-y-auto rounded-md border border-border bg-muted/30 p-4 space-y-3"
      >
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            No messages yet. Send one below.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              m.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background border border-border"
              )}
            >
              {m.content || (m.role === "assistant" && streaming ? "…" : "")}
            </div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="mt-3 flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          className="text-sm min-h-[44px] max-h-[120px] resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={streaming}
        />
        {streaming ? (
          <Button size="icon" variant="outline" onClick={stop} title="Stop">
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="icon" onClick={send} disabled={!input.trim()} title="Send">
            <Send className="h-4 w-4" />
          </Button>
        )}
        <Button
          size="icon"
          variant="outline"
          onClick={clearChat}
          disabled={messages.length === 0}
          title="Clear chat"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <BookPickerModal
        open={bookModalOpen}
        onOpenChange={setBookModalOpen}
        existingIds={selectedBooks.map((b) => b.id)}
        onAdd={addBooks}
      />
    </div>
  );
}

// ponytail: modal in same file. Two components with shared types is fine —
// extracting to its own file is premature until this grows.
type AdminBook = {
  id: string;
  title: string;
  author: string | null;
  txtTokens: number | null;
  language?: string;
};

function BookPickerModal({
  open,
  onOpenChange,
  existingIds,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existingIds: string[];
  onAdd: (books: SelectedBook[]) => void;
}) {
  const [loaded, setLoaded] = useState<AdminBook[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Reset + load first page whenever the modal opens.
  // ponytail: setState-in-effect is intentional here — we want fresh state each
  // time the dialog opens. Remounting via key would require restructuring the
  // Dialog's open/close animation. The dep is `open` (parent state), not any of
  // the state being set, so this can't actually cascade.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setLoaded([]);
    setPage(1);
    setHasMore(true);
    setSearch("");
    setPending(new Set());
    loadPage(1);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function loadPage(p: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/books?page=${p}`);
      if (!res.ok) throw new Error("Failed to load books");
      const data = await res.json();
      const books: AdminBook[] = (data.books ?? []).map((b: any) => ({
        id: b.id,
        title: b.title,
        author: b.author ?? null,
        txtTokens: b.txtTokens ?? null,
        language: b.language,
      }));
      setLoaded((prev) => (p === 1 ? books : [...prev, ...books]));
      setHasMore(books.length > 0 && loaded.length + books.length < (data.total ?? Infinity));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load books");
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function commit() {
    const toAdd = loaded.filter(
      (b) => pending.has(b.id) && !existingIds.includes(b.id)
    );
    onAdd(toAdd);
    onOpenChange(false);
  }

  const filtered = search.trim()
    ? loaded.filter((b) => {
        const q = search.toLowerCase();
        return (
          b.title.toLowerCase().includes(q) ||
          (b.author?.toLowerCase().includes(q) ?? false)
        );
      })
    : loaded;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add books to context</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or author…"
            className="pl-8 text-sm"
          />
        </div>
        <div className="max-h-[400px] overflow-y-auto rounded-md border border-border">
          {filtered.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground text-center py-8">
              {loaded.length === 0 ? "No books found." : "No matches."}
            </p>
          )}
          {filtered.map((b) => {
            const already = existingIds.includes(b.id);
            const checked = already || pending.has(b.id);
            return (
              <label
                key={b.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 border-b border-border last:border-b-0 cursor-pointer",
                  checked ? "bg-muted/50" : "hover:bg-muted/30",
                  already && "opacity-60 cursor-not-allowed"
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={already}
                  onChange={() => toggle(b.id)}
                  className="h-4 w-4"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{b.title}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {b.author || "Unknown author"}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {b.txtTokens === null
                    ? "not tokenized"
                    : `~${formatTokens(b.txtTokens)}`}
                  {already && " · added"}
                </span>
              </label>
            );
          })}
          {loading && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Loading…
            </p>
          )}
        </div>
        {hasMore && !search && (
          <div className="flex justify-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const next = page + 1;
                setPage(next);
                loadPage(next);
              }}
              disabled={loading}
            >
              Load more
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={commit} disabled={pending.size === 0}>
            Add {pending.size > 0 ? `(${pending.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
