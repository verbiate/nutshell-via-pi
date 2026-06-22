"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const CATEGORY_LABELS: Record<string, string> = {
  explainer_too_large: "Too large",
  missing_api_key: "Missing API key",
  openrouter_error: "OpenRouter error",
  upload_blocked: "Upload blocked",
};

const CATEGORY_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  explainer_too_large: "secondary",
  missing_api_key: "destructive",
  openrouter_error: "destructive",
  upload_blocked: "secondary",
};

export default function AdminErrorsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"unresolved" | "all">("unresolved");

  const { data, isPending } = useQuery({
    queryKey: ["admin-errors", filter],
    queryFn: async () => {
      const url =
        filter === "unresolved"
          ? "/api/admin/errors?resolved=false&limit=100"
          : "/api/admin/errors?limit=100";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load errors");
      return res.json();
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/admin/errors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, resolved: true }),
      });
      if (!res.ok) throw new Error("Failed to resolve");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-errors"] });
      toast.success("Marked resolved");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to resolve");
    },
  });

  const errors = data?.errors ?? [];
  const unresolvedCount = data?.unresolvedCount ?? 0;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-[20px] font-semibold text-foreground">Errors</h1>
        {unresolvedCount > 0 && (
          <Badge variant="destructive">{unresolvedCount} unresolved</Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Failures recorded by the explainer and upload pipelines. Resolve when triaged.
      </p>

      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          variant={filter === "unresolved" ? "default" : "outline"}
          onClick={() => setFilter("unresolved")}
        >
          Unresolved
        </Button>
        <Button
          size="sm"
          variant={filter === "all" ? "default" : "outline"}
          onClick={() => setFilter("all")}
        >
          All
        </Button>
      </div>

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Category</TableHead>
              <TableHead>Message</TableHead>
              <TableHead className="w-[120px]">Book</TableHead>
              <TableHead className="w-[160px]">When</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : errors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                  No errors {filter === "unresolved" ? "to triage" : "recorded"}.
                </TableCell>
              </TableRow>
            ) : (
              errors.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Badge variant={CATEGORY_VARIANTS[e.category] ?? "outline"}>
                      {CATEGORY_LABELS[e.category] ?? e.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{e.message}</div>
                    {e.context && (
                      <pre className="mt-1 text-[10px] text-muted-foreground font-mono whitespace-pre-wrap">
                        {e.context}
                      </pre>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {e.bookId ? e.bookId.slice(-8) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {e.resolved ? (
                      <Badge variant="secondary">resolved</Badge>
                    ) : (
                      <Badge variant="outline">open</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!e.resolved && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resolveMutation.mutate(e.id)}
                        disabled={resolveMutation.isPending}
                      >
                        Resolve
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
