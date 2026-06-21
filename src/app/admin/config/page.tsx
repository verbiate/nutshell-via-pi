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
  { key: "openrouter", label: "OpenRouter", fields: ["apiKey", "model"] as const },
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
              // ponytail: untouched/empty apiKey = "skip" (don't wipe a stored key
              // by accident — empty password field is the default, not a clear intent);
              // empty model/voiceId = "clear" (send null, server sets to null).
              f === "apiKey" ? edits[f] || undefined : displayValue(f) || null,
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
        {fields.map((field) => (
          <div key={field} className="space-y-2">
            <Label className="text-xs text-muted-foreground capitalize">{field}</Label>
            <Input
              type={field === "apiKey" ? "password" : "text"}
              value={displayValue(field)}
              onChange={(e) =>
                setEdits((prev) => ({ ...prev, [field]: e.target.value }))
              }
              placeholder={field === "apiKey" ? "Enter new key" : field === "model" ? "Model ID" : "Voice ID"}
              className="text-sm"
            />
            {field === "apiKey" && existing[field] && (
              <p className="text-xs text-muted-foreground">Current: {existing[field]}</p>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save Configuration"}
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
    </div>
  );
}
