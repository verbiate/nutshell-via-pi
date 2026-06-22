"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Send, Square, Trash2, RotateCcw, ChevronDown, ChevronUp,
  BookPlus, X, Search, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/use-session";
import { LANGUAGES } from "@/lib/languages";
import { countTokens, formatTokens } from "@/lib/client-tokens";

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

export default function PlaygroundPage() {
  // --- Admin session (for default target language) ---
  const { user } = useSession();
  const preferredLanguage: string =
    (user as any)?.preferredLanguage || "en";

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

  // --- Prompt overrides: session-local scratchpads, one per template. ---
  // Canonical editors live at /admin/prompts. Playground fields initialize from
  // saved values (system prompt via its own API, templates via the prompts API)
  // and from the admin's preferredLanguage for the language dropdown. Edits are
  // literal — what's in the field is what gets sent. Reset per field restores
  // the saved baseline. Only `system` and `book` are wired into the discussion
  // route today; section/passage/book_pass2 are visible but disabled.
  const { data: promptData } = useQuery({
    queryKey: ["admin-system-prompt"],
    queryFn: async () => {
      const res = await fetch("/api/admin/system-prompt");
      if (!res.ok) throw new Error("Failed to load system prompt");
      return res.json();
    },
  });
  const savedSystemPrompt: string = promptData?.prompt ?? "";

  const { data: templatesData } = useQuery({
    queryKey: ["admin-prompts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/prompts");
      if (!res.ok) throw new Error("Failed to load prompt templates");
      return res.json();
    },
  });
  const savedTemplates: Record<string, string> = {};
  for (const t of templatesData?.templates ?? []) {
    savedTemplates[t.type] = t.content ?? "";
  }

  const [systemOverride, setSystemOverride] = useState("");
  const [bookOverride, setBookOverride] = useState("");
  const [sectionOverride, setSectionOverride] = useState("");
  const [passageOverride, setPassageOverride] = useState("");
  const [bookPass2Override, setBookPass2Override] = useState("");
  const [targetLanguage, setTargetLanguage] = useState(preferredLanguage);
  const [promptOpen, setPromptOpen] = useState(false);

  // ponytail: hydrate all override fields ONCE after both saved sources load.
  // Avoids clobbering admin edits on refetch, and avoids a permanently-dirty
  // state from empty-string defaults. seededRef gates "have we initialized".
  // setState-in-effect is intentional here — pattern matches BookPickerModal.
  const seededRef = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (seededRef.current) return;
    if (!promptData || !templatesData) return;
    setSystemOverride(savedSystemPrompt);
    setBookOverride(savedTemplates.book ?? "");
    setSectionOverride(savedTemplates.section ?? "");
    setPassageOverride(savedTemplates.passage ?? "");
    setBookPass2Override(savedTemplates.book_pass2 ?? "");
    seededRef.current = true;
  }, [promptData, templatesData, savedSystemPrompt]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Also keep targetLanguage in sync if the admin changes their preference
  // elsewhere — only seed once, mirroring the override fields.
  // ponytail: setState-in-effect is intentional here — we want to seed once
  // when the session resolves. Pattern matches BookPickerModal below. Dep is
  // preferredLanguage (from session), not the state being set, so it can't
  // actually cascade.
  const langSeededRef = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (langSeededRef.current) return;
    setTargetLanguage(preferredLanguage);
    langSeededRef.current = true;
  }, [preferredLanguage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // --- Chat state ---
  const [tier, setTier] = useState<Tier>("admin");
  const [customModel, setCustomModel] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // Two-pass phase indicator: null when idle, "explaining" during hidden pass 1,
  // "refining" during streamed pass 2. Surfaced as a badge on the streaming bubble.
  const [twoPassPhase, setTwoPassPhase] = useState<"explaining" | "refining" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Selected books (context) ---
  const [selectedBooks, setSelectedBooks] = useState<SelectedBook[]>([]);
  const [bookModalOpen, setBookModalOpen] = useState(false);

  const activeModel = customModel.trim() || modelForTier(tier) || null;
  const activeModelLabel = activeModel ?? "(not configured)";

  // --- Context window for the active model ---
  // ponytail: always resolve via /api/admin/playground/model-info. The server
  // wraps getContextWindow (model-info.ts) which hits OpenRouter's model list
  // with a 24h process cache and falls back to FALLBACK_CONTEXT on any error.
  const [remote, setRemote] = useState<{
    model: string;
    window: number;
    source: "cache" | "fetch" | "fallback";
  } | null>(null);

  useEffect(() => {
    if (!activeModel) return;
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
          window: 0,
          source: "fallback",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeModel]);

  // ponytail: while a fetch is in flight or doesn't match the current model,
  // window is undefined and we render a loading state. The server's fallback
  // (120K) is reported as source="fallback" via the API, not synthesized here.
  const contextWindow =
    remote?.model === activeModel ? remote.window : undefined;
  const contextSource: "cache" | "fetch" | "fallback" | "loading" =
    remote?.model === activeModel ? remote.source : "loading";

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
  function clearBooks() {
    setSelectedBooks([]);
    setMessages([]);
  }

  // Token estimates for the indicator.
  // Books: real BPE count from DB (cl100k_base), computed at upload or
  // lazy-backfilled on first selection. Null = still computing.
  // Discussion: client-side BPE on the WIRED override fields (system + book) +
  // every message + the input draft. Section/passage/book_pass2 are not sent
  // today, so they don't count toward the budget.
  // ponytail: per-piece encode (not joined) — matches how the API actually
  // counts message boundaries; ~4 tokens of per-message overhead ignored.
  const bookTokens = selectedBooks.reduce(
    (s, b) => s + (b.txtTokens ?? 0),
    0
  );
  const booksLoading = selectedBooks.some((b) => b.txtTokens === null);
  const chatTokens =
    countTokens(systemOverride) +
    (selectedBooks.length > 0 ? countTokens(bookOverride) : 0) +
    messages.reduce((s, m) => s + countTokens(m.content), 0) +
    countTokens(input);
  const usedTokens = bookTokens + chatTokens;
  // ponytail: window may be undefined while the model-info fetch is in flight
  // or 0 on fallback-error. Hide the bar (pct=0, overBudget=false) until it
  // resolves; the label still shows used tokens + "(loading)".
  const window = contextWindow ?? 0;
  const pct = window > 0 ? Math.min(100, (usedTokens / window) * 100) : 0;
  const overBudget = window > 0 && usedTokens > window * 0.9;

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
          targetLanguage,
          // Only the wired overrides go on the wire. Disabled fields stay local.
          promptOverrides: {
            system: systemOverride,
            book: bookOverride,
          },
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
        toast.error(err?.message || "Discussion failed");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  // Two-pass runner: single-shot audition. Requires exactly one book attached.
  // Pass 1 (book template) runs hidden server-side; pass 2 (book_pass2 template
  // filled with {{previous_response}}) streams to the client as the next
  // assistant message. The discussion input is ignored — two-pass is not a
  // discussion turn, it's a fresh single-shot explainer call.
  async function runTwoPass() {
    if (streaming) return;
    if (selectedBooks.length !== 1) {
      toast.error("Two-pass requires exactly one book attached");
      return;
    }
    if (!activeModel) {
      toast.error(`No model configured for ${tier} tier`);
      return;
    }

    const assistantIndex = messages.length;
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    setStreaming(true);
    setTwoPassPhase("explaining");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/admin/playground/two-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          model: customModel.trim() || undefined,
          bookId: selectedBooks[0].id,
          targetLanguage,
          promptOverrides: {
            book: bookOverride,
            book_pass2: bookPass2Override,
          },
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
            if (parsed.type === "error") {
              toast.error(parsed.error);
              setMessages((prev) =>
                prev.filter((_, i) => i !== assistantIndex)
              );
              return;
            }
            if (parsed.type === "status" && parsed.stage) {
              setTwoPassPhase(parsed.stage as "explaining" | "refining");
            }
            if (parsed.type === "chunk" && parsed.chunk) {
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
        toast.error(err?.message || "Two-pass failed");
      }
    } finally {
      setStreaming(false);
      setTwoPassPhase(null);
      abortRef.current = null;
    }
  }

  function clearDiscussion() {
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
          <div className="flex items-center gap-2">
            {selectedBooks.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={clearBooks}
                disabled={streaming}
                title="Remove all books from context"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear all books
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBookModalOpen(true)}
              // ponytail: Playground fills the book template per attached book.
              // Multi-book fill is a future task; hard-cap at 1 here so the
              // backend constraint (chat/route.ts) can't be bypassed from the UI.
              disabled={streaming || selectedBooks.length >= 1}
              title={
                selectedBooks.length >= 1
                  ? "Playground supports at most one book. Remove the attached book to add another."
                  : undefined
              }
            >
              <BookPlus className="h-3.5 w-3.5 mr-1" />
              Add book
            </Button>
          </div>
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

      {/* Prompt overrides: session-local scratchpads, one per template plus the
          target language dropdown. Canonical editors live at /admin/prompts.
          Each field initializes from saved; edits are literal. Only `system`
          and `book` are wired into the discussion route today; the others are
          visible-but-disabled with tooltips. Language initializes from the
          admin's preferredLanguage and fills {{target_language}} in templates. */}
      <Card className="mt-3">
        <button
          type="button"
          onClick={() => setPromptOpen((v) => !v)}
          className="w-full flex items-center justify-between p-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Prompt overrides</span>
            <Badge variant="outline" className="text-[10px]">
              {[
                systemOverride !== savedSystemPrompt && "system",
                bookOverride !== (savedTemplates.book ?? "") && "book",
                targetLanguage !== preferredLanguage && "lang",
              ]
                .filter(Boolean)
                .join(", ") || "all default"}
            </Badge>
          </div>
          {promptOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {promptOpen && (
          // ponytail: cap the panel height + scroll internally so all 5 fields
          // don't push the discussion composer off-screen. ~40vh fits ~2 fields
          // visible at once on a typical viewport and scrolls for the rest.
          // Header (chevron + label) stays outside so collapse is always reachable.
          <div className="max-h-[40vh] overflow-y-auto border-t border-border px-3 pb-3 pt-3 space-y-4">
            {/* Target language: 2-char dropdown. Defaults to admin preferredLanguage. */}
            <OverrideRow
              label="Target language"
              badge={
                targetLanguage === preferredLanguage
                  ? { text: "Default", variant: "secondary" as const }
                  : { text: "Override active", variant: "default" as const }
              }
              onReset={() => setTargetLanguage(preferredLanguage)}
              resetDisabled={streaming || targetLanguage === preferredLanguage}
              resetLabel="Reset to preference"
            >
              <Select
                value={targetLanguage}
                onValueChange={setTargetLanguage}
                disabled={streaming}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </OverrideRow>

            {/* System prompt: WIRED — sent as system message when non-empty. */}
            <OverrideTextareaRow
              label="System prompt"
              value={systemOverride}
              onChange={setSystemOverride}
              savedValue={savedSystemPrompt}
              disabled={streaming}
              placeholder="Empty = no system message sent. Edit canonical under Prompt Templates → System Prompt."
              minH="min-h-[80px]"
            />

            {/* Book template: WIRED — filled per attached book and sent as system message. */}
            <OverrideTextareaRow
              label="Book template"
              value={bookOverride}
              onChange={setBookOverride}
              savedValue={savedTemplates.book ?? ""}
              disabled={streaming}
              placeholder="Used when a book is attached. {{book_text}}, {{title}}, {{author}}, {{language}}, {{target_language}} available."
              minH="min-h-[120px]"
              mono
            />

            {/* Section template: NOT WIRED — visible for parity, disabled with tooltip. */}
            <OverrideTextareaRow
              label="Section template"
              value={sectionOverride}
              onChange={setSectionOverride}
              savedValue={savedTemplates.section ?? ""}
              disabled={true}
              placeholder="Not wired into discussion yet — edit on Prompt Templates → Section-Level."
              minH="min-h-[80px]"
              mono
              tooltip="Section selection UI is future work. Edit on Prompt Templates page to affect production explainers."
            />

            {/* Passage template: NOT WIRED. */}
            <OverrideTextareaRow
              label="Passage template"
              value={passageOverride}
              onChange={setPassageOverride}
              savedValue={savedTemplates.passage ?? ""}
              disabled={true}
              placeholder="Not wired into discussion yet — edit on Prompt Templates."
              minH="min-h-[80px]"
              mono
              tooltip="Passage selection UI is future work. Edit on Prompt Templates page to affect production explainers."
            />

            {/* Pass-2 template: WIRED to Run two-pass button in the composer.
                Click that button to execute a single-shot pass-1 (hidden) →
                pass-2 (streamed) cycle against the attached book. */}
            <OverrideTextareaRow
              label="Pass-2 (refinement) template"
              value={bookPass2Override}
              onChange={setBookPass2Override}
              savedValue={savedTemplates.book_pass2 ?? ""}
              disabled={streaming}
              placeholder="Used by Run two-pass. {{previous_response}}, {{book_text}}, {{title}}, {{author}}, {{language}}, {{target_language}} available."
              minH="min-h-[80px]"
              mono
              tooltip="Click 'Run two-pass' in the composer to test against the attached book. Pass 1 hidden, pass 2 streamed."
            />
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
            No messages yet. Start the discussion below.
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
              {/* Two-pass phase indicator: shown only on the streaming bubble
                  while a two-pass run is in progress. Tells the admin which
                  hidden phase is consuming their request. */}
              {m.role === "assistant" && streaming &&
                i === messages.length - 1 && twoPassPhase && (
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 animate-pulse" />
                  {twoPassPhase === "explaining"
                    ? "Pass 1 explaining (hidden)…"
                    : "Pass 2 refining…"}
                </div>
              )}
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
          placeholder="Type a message to discuss…"
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
          <>
            <Button
              size="icon"
              onClick={send}
              disabled={!input.trim()}
              title="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
            {/* Two-pass runner: single-shot audition against the attached book.
                Disabled unless exactly one book is attached. The discussion
                input is ignored — two-pass is a fresh single-shot call, not a
                discussion turn. */}
            <Button
              size="icon"
              variant="outline"
              onClick={runTwoPass}
              disabled={selectedBooks.length !== 1}
              title={
                selectedBooks.length === 1
                  ? "Run two-pass (pass 1 hidden, pass 2 streamed)"
                  : "Attach exactly one book to enable two-pass"
              }
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          </>
        )}
        <Button
          size="icon"
          variant="outline"
          onClick={clearDiscussion}
          disabled={messages.length === 0}
          title="Clear discussion"
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

// ponytail: two small helper components for the Prompt overrides panel. Kept
// in this file (not split out) — single-use, tightly coupled to Playground
// state. OverrideRow = generic row with label/badge/reset; OverrideTextareaRow
// specializes it with a Textarea body. Both keep the per-row state badge
// logic (Matches saved / Override active / Disabled) in one place.

function OverrideRow({
  label,
  badge,
  onReset,
  resetDisabled,
  resetLabel = "Reset to saved",
  children,
}: {
  label: string;
  badge: { text: string; variant: "default" | "secondary" | "outline" };
  onReset: () => void;
  resetDisabled?: boolean;
  resetLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-foreground">{label}</Label>
          <Badge variant={badge.variant} className="text-[10px]">
            {badge.text}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onReset}
          disabled={resetDisabled}
          className="h-6 px-2 text-[11px]"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          {resetLabel}
        </Button>
      </div>
      {children}
    </div>
  );
}

function OverrideTextareaRow({
  label,
  value,
  onChange,
  savedValue,
  disabled,
  placeholder,
  minH = "min-h-[80px]",
  mono = false,
  tooltip,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  savedValue: string;
  disabled: boolean;
  placeholder: string;
  minH?: string;
  mono?: boolean;
  tooltip?: string;
}) {
  const matchesSaved = value === savedValue;
  const badge = disabled
    ? { text: "Not wired", variant: "outline" as const }
    : matchesSaved
    ? { text: "No edits made", variant: "secondary" as const }
    : { text: "Override active", variant: "default" as const };
  return (
    <OverrideRow
      label={label}
      badge={badge}
      onReset={() => onChange(savedValue)}
      resetDisabled={disabled || matchesSaved}
    >
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("text-xs", minH, mono && "font-mono")}
        disabled={disabled}
        title={disabled ? tooltip ?? "" : undefined}
      />
    </OverrideRow>
  );
}
