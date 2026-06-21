"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Send, Square, Trash2, Save, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

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

  // ponytail: switching tier or customModel invalidates the conversation — the
  // prior turns were against a different model/context, so keeping them would
  // mislead. Cleared in the change handlers directly.
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

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const activeModelLabel =
    customModel.trim() || modelForTier(tier) || "(not configured)";

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    if (!customModel.trim() && !modelForTier(tier)) {
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
    </div>
  );
}
