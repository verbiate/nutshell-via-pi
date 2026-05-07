"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

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

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-slate-900">
        Prompt Templates
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Edit LLM prompt templates for Explainer generation
      </p>

      <div className="mt-6">
        <Tabs defaultValue="book">
          <TabsList>
            <TabsTrigger value="book">Book-Level</TabsTrigger>
            <TabsTrigger value="section">Section-Level</TabsTrigger>
          </TabsList>
          <TabsContent value="book">
            <PromptEditor
              type="book"
              initialContent={bookTemplate?.content || ""}
              version={bookTemplate?.version || 1}
            />
          </TabsContent>
          <TabsContent value="section">
            <PromptEditor
              type="section"
              initialContent={sectionTemplate?.content || ""}
              version={sectionTemplate?.version || 1}
            />
          </TabsContent>
        </Tabs>
      </div>
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
