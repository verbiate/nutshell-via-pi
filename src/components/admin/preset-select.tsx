"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Bookmark, Save, Trash2, X, Check } from "lucide-react";

type Preset = {
  id: string;
  type: string;
  name: string;
  content: string;
  updatedAt: string;
};

// ponytail: shared preset bar used by both /admin/prompts (PromptEditor) and
// /admin/playground (enabled OverrideTextareaRows). Reads presets for one level,
// lets the admin load one into the parent's field, save the current field as a
// named preset, or delete a preset. Presets are NOT the live template — loading
// is a deliberate scratchpad action that leaves the parent field dirty vs saved.
export function PresetSelect({
  type,
  currentContent,
  onLoad,
  disabled,
}: {
  type: string;
  currentContent?: string;
  onLoad: (content: string) => void;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  const { data } = useQuery({
    queryKey: ["admin-prompt-presets", type],
    queryFn: async () => {
      const res = await fetch(`/api/admin/prompt-presets?type=${type}`);
      if (!res.ok) throw new Error("Failed to load presets");
      return res.json() as Promise<{ presets: Preset[] }>;
    },
  });
  const presets = data?.presets ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-prompt-presets"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/prompt-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name, content: currentContent ?? "" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");
      return body as Preset;
    },
    onSuccess: (preset) => {
      toast.success(`Preset "${preset.name}" saved`);
      setSelectedId(preset.id);
      setSaving(false);
      setName("");
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Save failed"),
  });

  const updateMutation = useMutation({
    // ponytail: "overwrite" = save the current field content back into the
    // selected preset. Named-save and delete are the only other preset writes.
    mutationFn: async () => {
      const res = await fetch(`/api/admin/prompt-presets/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: currentContent ?? "" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Update failed");
    },
    onSuccess: () => {
      toast.success("Preset updated");
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/prompt-presets/${selectedId}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Delete failed");
    },
    onSuccess: () => {
      toast.success("Preset deleted");
      setSelectedId("");
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Delete failed"),
  });

  const hasContent = !!currentContent;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
      <Select
        value={selectedId}
        disabled={disabled}
        onValueChange={(id) => {
          setSelectedId(id);
          const preset = presets.find((p) => p.id === id);
          if (preset) {
            onLoad(preset.content);
            toast.info(`Loaded preset "${preset.name}"`);
          }
        }}
      >
        <SelectTrigger className="h-7 w-[160px] text-xs">
          <SelectValue placeholder="Load preset…" />
        </SelectTrigger>
        <SelectContent>
          {presets.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No presets yet
            </div>
          )}
          {presets.map((p) => (
            <SelectItem key={p.id} value={p.id} className="text-xs">
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedId && hasContent && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          disabled={disabled || updateMutation.isPending}
          onClick={() => updateMutation.mutate()}
          title="Overwrite the selected preset with current content"
        >
          <Save className="h-3 w-3 mr-1" />
          Update
        </Button>
      )}

      {selectedId && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          disabled={disabled || deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
          title="Delete the selected preset"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}

      {saving ? (
        <span className="flex items-center gap-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Preset name…"
            className="h-7 w-[140px] text-xs"
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) createMutation.mutate();
              if (e.key === "Escape") {
                setSaving(false);
                setName("");
              }
            }}
            autoFocus
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            disabled={!name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => {
              setSaving(false);
              setName("");
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          disabled={disabled || !hasContent}
          onClick={() => setSaving(true)}
          title="Save current content as a new preset"
        >
          Save as…
        </Button>
      )}
    </div>
  );
}
