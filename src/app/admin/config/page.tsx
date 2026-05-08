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
      return res.json();
    },
  });

  const configs = data?.configs || [];
  const existing = configs.find((c: any) => c.userType === tier) || {};

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f, (existing[f] as string) || ""]))
  );

  const hasChanges = fields.some((f) => values[f] !== ((existing[f] as string) || ""));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          userType: tier,
          ...Object.fromEntries(fields.map((f) => [f, values[f] || undefined])),
        }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-config", category] });
      toast.success("Configuration saved");
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
              value={values[field]}
              onChange={(e) => setValues((prev) => ({ ...prev, [field]: e.target.value }))}
              placeholder={field === "apiKey" ? "sk-..." : field === "model" ? "Model ID" : "Voice ID"}
              className="text-sm"
            />
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
      <h1 className="text-[20px] font-semibold text-slate-900">API Keys & Models</h1>
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
