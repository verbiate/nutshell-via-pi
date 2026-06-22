"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AVAILABLE_TOKENS } from "@/lib/prompt-tokens";

export default function PromptTemplatesPage() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["admin-prompts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/prompts");
      return res.json();
    },
  });

  const templates = data?.templates || [];
  const bookTemplate = templates.find((t: any) => t.type === "book");
  const sectionTemplate = templates.find((t: any) => t.type === "section");
  const bookPass2Template = templates.find((t: any) => t.type === "book_pass2");
  const bookMetadataTemplate = templates.find(
    (t: any) => t.type === "book_metadata"
  );
  const twoPassEnabled: boolean = data?.twoPassEnabled === true;

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-foreground">
        Prompt Templates
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Edit LLM prompt templates for Explainer generation
      </p>

      {/* Token reference: collapsible so it doesn't crowd the editor.
          ponytail: no Collapsible in the ui kit — a labelled Button toggles
          a local useState flag, same pattern as the TwoPassSection toggle. */}
      <TokenReferencePanel />

      <div className="mt-6">
        <Tabs defaultValue="book">
          <TabsList>
            <TabsTrigger value="book">Book-Level</TabsTrigger>
            <TabsTrigger value="section">Section-Level</TabsTrigger>
            <TabsTrigger value="metadata">Metadata</TabsTrigger>
            <TabsTrigger value="system">System Prompt</TabsTrigger>
          </TabsList>
          <TabsContent value="book">
            <PromptEditor
              type="book"
              initialContent={bookTemplate?.content || ""}
              version={bookTemplate?.version || 1}
            />
            {/* Two-pass refinement: hidden pass-1 explanation followed by a
                streamed pass-2 refinement. Toggle is the bookTwoPassEnabled
                AppSetting; the editor below is the book_pass2 PromptTemplate.
                Pass-2 is token-pattern — {{previous_response}} carries pass-1's
                draft into the template body. */}
            <TwoPassSection
              enabled={twoPassEnabled}
              pass2InitialContent={bookPass2Template?.content || ""}
              pass2Version={bookPass2Template?.version || 1}
              loaded={!isPending}
            />
          </TabsContent>
          <TabsContent value="section">
            <PromptEditor
              type="section"
              initialContent={sectionTemplate?.content || ""}
              version={sectionTemplate?.version || 1}
            />
          </TabsContent>
          <TabsContent value="metadata">
            {/* ponytail: LLM book-metadata extraction prompt. Returns strict
                JSON via response_format json_object. Only {{book_text}} is
                substituted — the whole point is to derive the other fields
                (title/author/etc) rather than feed them in. Bumping version
                invalidates nothing automatic (no cache row), but admins
                running re-extract after a prompt change get the new behavior. */}
            <div className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Returns strict JSON. Only <code className="font-mono">{"{{book_text}}"}</code> is substituted.
              Used by the <strong>Book Metadata</strong> admin page.
            </div>
            <PromptEditor
              type="book_metadata"
              initialContent={bookMetadataTemplate?.content || ""}
              version={bookMetadataTemplate?.version || 1}
            />
          </TabsContent>
          <TabsContent value="system">
            {/* Canonical global system prompt. Persisted via the
                globalSystemPrompt AppSetting; Playground reads the same value
                for its "Reset to default" pull but never auto-applies it. */}
            <SystemPromptEditor />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function TokenReferencePanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-md border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
          Token reference
        </span>
        <span className="text-xs text-muted-foreground">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Tokens are substituted at generation time. Use them verbatim, e.g.
            <code className="mx-1 rounded bg-background px-1 py-0.5 font-mono">
              {"{{book_text}}"}</code>
            . Not every token is valid for every template — check the
            &ldquo;Applies to&rdquo; column.
          </p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Token</th>
                  <th className="px-2 py-1.5 font-medium">Description</th>
                  <th className="px-2 py-1.5 font-medium">Applies to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-background">
                {AVAILABLE_TOKENS.map((t) => (
                  <tr key={t.token}>
                    <td className="whitespace-nowrap px-2 py-1.5 align-top font-mono">
                      {`{{${t.token}}}`}
                    </td>
                    <td className="px-2 py-1.5 align-top text-muted-foreground">
                      {t.description}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 align-top text-muted-foreground">
                      {t.appliesTo.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function PromptEditor({
  type,
  initialContent,
  version,
}: {
  type: string;
  initialContent: string;
  version: number;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState(initialContent);
  const hasChanges = content !== initialContent;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/prompts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-prompts"] });
      toast.success("Template saved");
    },
  });

  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return (
    <div className="mt-4 space-y-3">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[300px] font-mono text-sm"
        placeholder="Enter prompt template..."
      />
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {wordCount} words · Version {version}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setContent(initialContent)}
            disabled={!hasChanges}
          >
            Discard Changes
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
          >
            Save Template
          </Button>
        </div>
      </div>
    </div>
  );
}

function TwoPassSection({
  enabled,
  pass2InitialContent,
  pass2Version,
  loaded,
}: {
  enabled: boolean;
  pass2InitialContent: string;
  pass2Version: number;
  loaded: boolean;
}) {
  const queryClient = useQueryClient();
  const toggleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/prompts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twoPassEnabled: !enabled }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-prompts"] });
      toast.success(enabled ? "Two-pass disabled" : "Two-pass enabled");
    },
  });

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Two-pass refinement
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Runs a hidden first pass, then streams a refined second pass to the
            reader. Doubles token cost and latency for book-level explainers.
            Pass-2 template uses <code className="font-mono">{"{{previous_response}}"}</code> for
            pass-1&apos;s draft and <code className="font-mono">{"{{book_text}}"}</code> for the
            source — drop either and pass 2 loses its grounding.
          </p>
        </div>
        {/* ponytail: no Switch in the ui kit — a labelled Button toggles the
            bookTwoPassEnabled AppSetting. Variant communicates state at a glance. */}
        <Button
          variant={enabled ? "default" : "outline"}
          size="sm"
          disabled={!loaded || toggleMutation.isPending}
          onClick={() => toggleMutation.mutate()}
        >
          {enabled ? "Enabled" : "Disabled"}
        </Button>
      </div>

      {/* ponytail: keep the pass-2 template mounted only when enabled. When off
          the template is irrelevant and hidden rows reduce visual noise. The
          PromptEditor resets initialContent when the query refetches. */}
      {enabled && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pass-2 instruction
          </p>
          <PromptEditor
            type="book_pass2"
            initialContent={pass2InitialContent}
            version={pass2Version}
          />
        </div>
      )}
    </div>
  );
}

// Canonical global system prompt editor. Persisted to the globalSystemPrompt
// AppSetting via PUT /api/admin/system-prompt. Playground reads the same
// query key (["admin-system-prompt"]) for its "Reset to default" pull, so
// invalidating here propagates to any mounted Playground automatically.
function SystemPromptEditor() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-system-prompt"],
    queryFn: async () => {
      const res = await fetch("/api/admin/system-prompt");
      if (!res.ok) throw new Error("Failed to load system prompt");
      return res.json();
    },
  });
  const savedPrompt: string | null = data?.prompt ?? null;

  const [content, setContent] = useState("");
  // ponytail: hydrate working copy once on first read of savedPrompt. Avoids
  // clobbering admin edits if the query refetches, and avoids a permanent
  // dirty state from the empty-string default. Ref tracks "have we seeded".
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && data) {
      setContent(savedPrompt ?? "");
      seededRef.current = true;
    }
  }, [data, savedPrompt]);

  const dirty = content !== (savedPrompt ?? "");

  const saveMutation = useMutation({
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

  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        Global system prompt sent with explainer-related chat calls. Empty
        means no system message. Playground uses this as the &ldquo;Reset to
        default&rdquo; baseline but never auto-applies it.
      </p>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[160px] font-mono text-sm"
        placeholder="Empty = no system message sent."
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {wordCount} words
          </span>
          {dirty ? (
            <Badge variant="outline" className="text-[10px]">Unsaved</Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">Saved</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setContent(savedPrompt ?? "")}
            disabled={!dirty || saveMutation.isPending}
          >
            Revert
          </Button>
          <Button
            onClick={() => saveMutation.mutate(content)}
            disabled={!dirty || saveMutation.isPending}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
