"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const TIERS = [
  { key: "regular", label: "Regular Tier" },
  { key: "pro", label: "Pro Tier" },
  { key: "admin", label: "Admin Tier" },
] as const;

const CATEGORIES = [
  { key: "openrouter", label: "OpenRouter", fields: ["apiKey", "model", "maxContextTokens", "maxOutputTokens"] as const },
  { key: "elevenlabs", label: "ElevenLabs", fields: ["apiKey", "model", "voiceId"] as const },
  { key: "fal", label: "fal.ai", fields: ["apiKey", "model", "voiceId"] as const },
] as const;

type ConfigCategory = (typeof CATEGORIES)[number]["key"];
type ConfigTier = (typeof TIERS)[number]["key"];

function ConfigRow({
  category,
  tier,
  fields,
}: {
  category: ConfigCategory;
  tier: ConfigTier;
  fields: readonly string[];
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-config", category],
    queryFn: async () => {
      const res = await fetch(`/api/admin/config?category=${category}`);
      if (!res.ok) throw new Error("Failed to load configuration");
      return res.json();
    },
  });

  const configs = data?.configs || [];
  const existing = configs.find((c: any) => c.userType === tier) || {};

  // ponytail: edits-overlay model. We read `existing` live on every render so the
  // inputs populate as soon as the query resolves, and the badge is correct from
  // the very first render. Avoids the useState-initializer-captures-empty-data
  // trap (which left fields empty + badge stuck on "Unsaved" after a hard
  // refresh) and avoids comparing typed-vs-masked-apiKey (the original bug).
  const [edits, setEdits] = useState<Record<string, string>>({});

  // apiKey is never auto-displayed — GET masks it, so showing the mask would
  // either be useless ("***") or trip a permanent dirty mismatch.
  const displayValue = (f: string) =>
    f in edits ? edits[f] : f === "apiKey" ? "" : (existing[f] as string) || "";

  const hasChanges = Object.keys(edits).length > 0;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          userType: tier,
          ...Object.fromEntries(
            fields.map((f) => [
              f,
              // ponytail: per-field encoding rules:
              //   apiKey: empty = "skip" (don't wipe stored key)
              //   maxContextTokens / maxOutputTokens: empty = null (clear override); non-empty = Number(...)
              //   everything else: empty = null (clear)
              f === "apiKey"
                ? edits[f] || undefined
                : f === "maxContextTokens" || f === "maxOutputTokens"
                ? (displayValue(f) ? Number(displayValue(f)) : null)
                : displayValue(f) || null,
            ])
          ),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      // Clear edits — server is source of truth again. Inputs will repopulate
      // from the refetched (unmasked-for-non-apiKey) server data.
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ["admin-config", category] });
      toast.success("Configuration saved");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Save failed");
    },
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">{TIERS.find((t) => t.key === tier)?.label}</h3>
        <Badge variant={hasChanges ? "default" : "secondary"}>
          {hasChanges ? "Unsaved" : "Saved"}
        </Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {fields.map((field) => {
          // ponytail: maxContextTokens + maxOutputTokens are numeric inputs with
          // custom placeholders. Display existing numeric value as string; empty
          // = cleared override.
          const isNumeric = field === "maxContextTokens" || field === "maxOutputTokens";
          const numericValue =
            isNumeric && existing[field] != null
              ? String(existing[field])
              : "";
          const label =
            field === "maxContextTokens"
              ? "Max context tokens (override)"
              : field === "maxOutputTokens"
              ? "Max output tokens (override)"
              : field;
          const placeholder =
            field === "apiKey"
              ? "Enter new key"
              : field === "model"
              ? "Model ID"
              : field === "maxContextTokens"
              ? "Empty = use model limit"
              : field === "maxOutputTokens"
              ? "Empty = use per-type default (4096 book / 2048 section / passage)"
              : "Voice ID";
          return (
            <div key={field} className="space-y-2">
              <Label className="text-xs text-muted-foreground capitalize">
                {label}
              </Label>
              <Input
                type={field === "apiKey" ? "password" : isNumeric ? "number" : "text"}
                value={field in edits ? edits[field] : (isNumeric ? numericValue : displayValue(field))}
                onChange={(e) =>
                  setEdits((prev) => ({ ...prev, [field]: e.target.value }))
                }
                placeholder={placeholder}
                className="text-sm"
              />
              {field === "apiKey" && existing[field] && (
                <p className="text-xs text-muted-foreground">Current: {existing[field]}</p>
              )}
              {field === "maxContextTokens" && (
                <p className="text-[10px] text-muted-foreground">
                  Empty = model context length lookup, else 128K fallback.
                </p>
              )}
              {field === "maxOutputTokens" && (
                <p className="text-[10px] text-muted-foreground">
                  {"Caps every answer length; folded into the prompt as a {{token_budget}} hint and into the cache key."}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save Configuration"}
        </Button>
      </div>
    </Card>
  );
}

type ShelfWikiStatus = {
  state: "idle" | "building" | "done" | "error";
  at?: string;
  counts?: { concepts: number; themes: number; files: number };
  message?: string;
};

function ShelfKnowledgeCard() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["shelf-wiki-status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/shelf-wiki/status");
      if (!res.ok) throw new Error("Failed to load shelf wiki status");
      return res.json() as Promise<ShelfWikiStatus>;
    },
    // ponytail: poll only while building; otherwise a single fetch suffices.
    refetchInterval: (q) =>
      q.state.data?.state === "building" ? 2000 : false,
  });

  const buildMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/shelf-wiki/build", { method: "POST" });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error === "already building" ? "already building" : "build busy");
      }
      if (!res.ok) throw new Error("Build failed to start");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shelf-wiki-status"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Build failed to start");
    },
  });

  const s = status ?? { state: "idle" } as ShelfWikiStatus;
  const isBuilding = s.state === "building" || buildMutation.isPending;

  const stateLabel: Record<ShelfWikiStatus["state"], string> = {
    idle: "Idle",
    building: "Building…",
    done: "Ready",
    error: "Error",
  };
  const badgeVariant: Record<ShelfWikiStatus["state"], "default" | "secondary"> = {
    idle: "secondary",
    building: "default",
    done: "default",
    error: "default",
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-medium">Shelf Knowledge</h3>
          <p className="text-xs text-muted-foreground">
            Compile the shelf wiki from extracted concepts + cluster themes.
          </p>
        </div>
        <Badge variant={badgeVariant[s.state]}>{stateLabel[s.state]}</Badge>
      </div>

      <div className="text-xs text-muted-foreground space-y-1 mb-4">
        {s.at && (
          <div>
            Last: {new Date(s.at).toLocaleString()}
          </div>
        )}
        {s.state === "done" && s.counts && (
          <div>
            {s.counts.concepts} concepts · {s.counts.themes} themes · {s.counts.files} files
          </div>
        )}
        {s.state === "error" && s.message && (
          <div className="text-destructive">{s.message}</div>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => buildMutation.mutate()}
          disabled={isBuilding}
        >
          {isBuilding ? "Building…" : "Build shelf wiki"}
        </Button>
      </div>
    </Card>
  );
}

export default function ConfigPage() {
  return (
    <div>
      <h1 className="text-[20px] font-semibold text-foreground">API Keys & Models</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure TTS providers and AI model assignments per user tier
      </p>

      <div className="mt-6">
        <Tabs defaultValue="openrouter">
          <TabsList>
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c.key} value={c.key}>
                {c.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {CATEGORIES.map((c) => (
            <TabsContent key={c.key} value={c.key} className="space-y-4 mt-4">
              {TIERS.map((t) => (
                <ConfigRow key={t.key} category={c.key} tier={t.key} fields={c.fields} />
              ))}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <div className="mt-8">
        <h2 className="text-[20px] font-semibold text-foreground">Shelf Knowledge</h2>
        <p className="mt-1 text-sm text-muted-foreground mb-4">
          Build the cross-book knowledge index that powers &ldquo;Ask Your Bookshelf&rdquo;
        </p>
        <ShelfKnowledgeCard />
      </div>
    </div>
  );
}
