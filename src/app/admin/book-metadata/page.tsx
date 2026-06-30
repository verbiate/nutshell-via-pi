"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { RotateCcw, Sparkles, Loader2 } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface BookListItem {
  id: string;
  title: string;
  author: string | null;
  language: string;
  md5: string;
}

interface GenerationTiming {
  generationMs: number;
  model: string;
  extractedAt: string;
}

interface MetadataView {
  epub: { title: string; author: string | null; language: string };
  metadata: {
    id: string;
    title: string;
    subtitle: string | null;
    description: string | null;
    author: string | null;
    authorGender: string | null;
    isNarrative: boolean | null;
    language: string | null;
    readableStartAnchor: string | null;
    readableStartOffset: number | null;
    readableEndAnchor: string | null;
    readableEndOffset: number | null;
    readableStartSectionHref: string | null;
    readableEndSectionHref: string | null;
    promptVersion: number;
    extractionCount: number;
    model: string | null;
    extractedAt: string;
    updatedAt: string;
    fastestGeneration: GenerationTiming | null;
    latestGeneration: GenerationTiming | null;
  } | null;
}

export default function BookMetadataPage() {
  const queryClient = useQueryClient();
  const [selectedBookId, setSelectedBookId] = useState<string>("");

  // ponytail: library is small (~tens of books); fetch all and filter
  // client-side via cmdk. Switch to server-side search if the universal
  // library ever grows past a few hundred rows.
  const { data: booksData } = useQuery({
    queryKey: ["admin-books", "all"],
    queryFn: async () => {
      const res = await fetch("/api/admin/books?pageSize=1000");
      return res.json();
    },
  });
  const books: BookListItem[] = booksData?.books ?? [];

  const metadataQuery = useQuery({
    queryKey: ["admin-book-metadata", selectedBookId],
    queryFn: async () => {
      // ponytail: cache:'no-store' bypasses browser HTTP heuristic cache so
      // post-mutation invalidation actually returns fresh data.
      const res = await fetch(
        `/api/admin/books/${selectedBookId}/metadata`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Failed to load metadata");
      return res.json() as Promise<MetadataView>;
    },
    enabled: !!selectedBookId,
  });

  const extractMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/admin/books/${selectedBookId}/extract-metadata`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Extraction failed");
      return json;
    },
    onSuccess: () => {
      toast.success("Metadata extracted");
      queryClient.invalidateQueries({
        queryKey: ["admin-book-metadata", selectedBookId],
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revertMutation = useMutation({
    mutationFn: async (field: "title" | "author" | "language") => {
      const res = await fetch(`/api/admin/books/${selectedBookId}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Revert failed");
      return json;
    },
    onSuccess: () => {
      toast.success("Reverted to original");
      queryClient.invalidateQueries({
        queryKey: ["admin-book-metadata", selectedBookId],
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const view = metadataQuery.data;
  const md = view?.metadata ?? null;
  const selectedBook = books.find((b) => b.id === selectedBookId);

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-foreground">
        Book Metadata
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Extract title, subtitle, author, author gender, narrative type, and
        language from a book via the admin-tier LLM.
      </p>

      <ModelSettingRow />
      <ReextractAllRow />

      <div className="mt-6 grid gap-6 lg:grid-cols-[400px_1fr]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              {selectedBook ? "Selected" : "Pick a book"}
            </h2>
            {selectedBook && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setSelectedBookId("")}
              >
                Change
              </Button>
            )}
          </div>

          {selectedBook ? (
            <div className="flex flex-col gap-1 rounded-md border bg-white p-3">
              <span className="line-clamp-2 text-sm font-medium text-foreground">
                {selectedBook.title}
              </span>
              <span className="text-xs text-muted-foreground">
                {selectedBook.author || "Unknown author"}
              </span>
              {selectedBook.language && selectedBook.language !== "und" && (
                <Badge variant="outline" className="mt-1 w-fit text-[10px]">
                  {selectedBook.language.toUpperCase()}
                </Badge>
              )}
            </div>
          ) : (
            <Command className="rounded-md border">
              <CommandInput placeholder="Search by title or author…" />
              <CommandList className="max-h-[420px]">
                <CommandEmpty>No books found.</CommandEmpty>
                <CommandGroup>
                  {books.map((b) => (
                    <CommandItem
                      key={b.id}
                      value={`${b.title} ${b.author ?? ""}`}
                      onSelect={() => setSelectedBookId(b.id)}
                      className="flex flex-col items-start gap-0.5 py-2"
                    >
                      <span className="line-clamp-1 w-full text-sm font-medium">
                        {b.title}
                      </span>
                      <span className="line-clamp-1 w-full text-xs text-muted-foreground">
                        {b.author || "Unknown author"}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
        </div>

        {selectedBookId && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Metadata</CardTitle>
              <Button
                size="sm"
                onClick={() => extractMutation.mutate()}
                disabled={extractMutation.isPending}
              >
                {extractMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {md ? "Re-extract" : "Extract Metadata"}
              </Button>
            </CardHeader>
            <CardContent>
              {metadataQuery.isPending ? (
                <div className="h-24 animate-pulse rounded bg-muted" />
              ) : md ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[140px]">Field</TableHead>
                        <TableHead>EPUB original</TableHead>
                        <TableHead>LLM-extracted</TableHead>
                        <TableHead className="w-[80px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <MetadataRow
                        label="Title"
                        epubValue={view?.epub.title ?? ""}
                        mdValue={md.title}
                        isRevertable
                        onRevert={() => revertMutation.mutate("title")}
                        revertPending={
                          revertMutation.isPending &&
                          revertMutation.variables === "title"
                        }
                      />
                      <MetadataRow
                        label="Subtitle"
                        epubValue="—"
                        mdValue={md.subtitle}
                      />
                      <MetadataRow
                        label="Description"
                        epubValue="—"
                        mdValue={md.description}
                      />
                      <MetadataRow
                        label="Author"
                        epubValue={view?.epub.author ?? "—"}
                        mdValue={md.author}
                        isRevertable
                        onRevert={() => revertMutation.mutate("author")}
                        revertPending={
                          revertMutation.isPending &&
                          revertMutation.variables === "author"
                        }
                      />
                      <MetadataRow
                        label="Author gender"
                        epubValue="—"
                        mdValue={md.authorGender}
                      />
                      <MetadataRow
                        label="Narrative"
                        epubValue="—"
                        mdValue={
                          md.isNarrative === null
                            ? "undetermined"
                            : md.isNarrative
                              ? "narrative"
                              : "non-narrative"
                        }
                      />
                      <MetadataRow
                        label="Language"
                        epubValue={view?.epub.language ?? "—"}
                        mdValue={md.language}
                        isRevertable
                        onRevert={() => revertMutation.mutate("language")}
                        revertPending={
                          revertMutation.isPending &&
                          revertMutation.variables === "language"
                        }
                      />
                      <AnchorRow
                        label="Readable start"
                        anchor={md.readableStartAnchor}
                        offset={md.readableStartOffset}
                        sectionHref={md.readableStartSectionHref}
                      />
                      <AnchorRow
                        label="Readable end"
                        anchor={md.readableEndAnchor}
                        offset={md.readableEndOffset}
                        sectionHref={md.readableEndSectionHref}
                      />
                    </TableBody>
                  </Table>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">v{md.promptVersion}</Badge>
                    <Badge variant="secondary">
                      #{md.extractionCount} extraction
                      {md.extractionCount === 1 ? "" : "s"}
                    </Badge>
                    {md.model && <Badge variant="outline">{md.model}</Badge>}
                    {md.fastestGeneration && (
                      <Badge variant="outline" className="text-green-600">
                        Best {(md.fastestGeneration.generationMs / 1000).toFixed(1)}s ·{" "}
                        {md.fastestGeneration.model}
                      </Badge>
                    )}
                    {md.fastestGeneration && md.latestGeneration &&
                      md.fastestGeneration.extractedAt !== md.latestGeneration.extractedAt && (
                        <Badge
                          variant="outline"
                          className={
                            md.latestGeneration.generationMs > md.fastestGeneration.generationMs
                              ? "text-amber-600"
                              : "text-green-600"
                          }
                        >
                          Latest {(md.latestGeneration.generationMs / 1000).toFixed(1)}s ·{" "}
                          {md.latestGeneration.model} (
                          {md.latestGeneration.generationMs > md.fastestGeneration.generationMs
                            ? `+${((md.latestGeneration.generationMs - md.fastestGeneration.generationMs) / 1000).toFixed(1)}s`
                            : `${((md.latestGeneration.generationMs - md.fastestGeneration.generationMs) / 1000).toFixed(1)}s`}{" "}
                          vs best)
                        </Badge>
                      )}
                    <span>
                      Extracted {new Date(md.extractedAt).toLocaleString()}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No metadata extracted yet. Click{" "}
                  <strong>Extract Metadata</strong> to run the LLM.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ponytail: anchor rows show the verbatim LLM-picked snippet (truncated, mono)
// plus the derived char offset as a badge so admins can eyeball whether the
// extraction pinned a location. Offset null = anchor wasn't found verbatim
// (LLM misquote) or no anchor was returned — both render as "not pinned".
function AnchorRow({
  label,
  anchor,
  offset,
  sectionHref,
}: {
  label: string;
  anchor: string | null;
  offset: number | null;
  sectionHref?: string | null;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium align-top">{label}</TableCell>
      <TableCell className="text-muted-foreground align-top">—</TableCell>
      <TableCell>
        {anchor ? (
          <div className="flex flex-col gap-1">
            <span className="line-clamp-3 font-mono text-xs leading-snug text-foreground">
              {anchor}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  offset === null ? "text-amber-600" : "text-green-600"
                }`}
              >
                {offset === null
                  ? "not pinned"
                  : `offset ${offset.toLocaleString()}`}
              </Badge>
              {sectionHref && (
                <Badge variant="outline" className="text-[10px] font-mono">
                  {sectionHref.split("/").pop() ?? sectionHref}
                </Badge>
              )}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground italic">not determined</span>
        )}
      </TableCell>
      <TableCell />
    </TableRow>
  );
}

function MetadataRow({
  label,
  epubValue,
  mdValue,
  isRevertable = false,
  onRevert,
  revertPending = false,
}: {
  label: string;
  epubValue: string;
  mdValue: string | null;
  isRevertable?: boolean;
  onRevert?: () => void;
  revertPending?: boolean;
}) {
  const differs =
    isRevertable &&
    mdValue !== null &&
    String(mdValue) !== String(epubValue);

  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="text-muted-foreground">{epubValue || "—"}</TableCell>
      <TableCell>
        {mdValue === null || mdValue === "" ? (
          <span className="text-muted-foreground italic">not determined</span>
        ) : (
          mdValue
        )}
      </TableCell>
      <TableCell>
        {isRevertable && differs && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            disabled={revertPending}
            onClick={onRevert}
            title="Revert to EPUB original"
          >
            {revertPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

// Model override for extraction. Persisted in AppSetting `bookMetadataModel`.
// When empty, the service falls back to the admin-tier model from the API
// Keys & Models page (the `fallback` field returned by the GET endpoint).
// ponytail: hydrate-once via seededRef so a background refetch doesn't
// clobber in-flight edits. Same pattern as SystemPromptEditor on the prompts
// page (see prompts/page.tsx:298-304).
function ModelSettingRow() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-book-metadata-settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/book-metadata-settings");
      if (!res.ok) throw new Error("Failed to load model setting");
      return res.json() as Promise<{ model: string | null; fallback: string }>;
    },
  });

  const savedModel: string | null = data?.model ?? null;
  const fallback: string = data?.fallback ?? "";
  const [value, setValue] = useState("");
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && data) {
      setValue(savedModel ?? "");
      seededRef.current = true;
    }
  }, [data, savedModel]);

  const dirty = value !== (savedModel ?? "");

  const saveMutation = useMutation({
    mutationFn: async (next: string) => {
      const res = await fetch("/api/admin/book-metadata-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: next || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin-book-metadata-settings"],
      });
      toast.success("Model updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border bg-white p-3">
      <label
        htmlFor="book-metadata-model"
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        Model
      </label>
      <Input
        id="book-metadata-model"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={fallback || "e.g. anthropic/claude-sonnet-4.6"}
        className="h-8 max-w-md font-mono text-xs"
      />
      <Button
        size="sm"
        className="h-8"
        disabled={!dirty || saveMutation.isPending}
        onClick={() => saveMutation.mutate(value)}
      >
        {saveMutation.isPending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : null}
        Save
      </Button>
      <p className="w-full text-[11px] text-muted-foreground">
        {dirty ? (
          <>Unsaved — save to apply to future extractions.</>
        ) : savedModel ? (
          <>Override in use. Clear and save to fall back.</>
        ) : (
          <>
            Using admin-tier default
            {fallback ? (
              <>
                {" "}
                (<span className="font-mono">{fallback}</span>)
              </>
            ) : null}
            .
          </>
        )}
      </p>
    </div>
  );
}

// ponytail: batch re-extract button + polled progress. Mirrors the shelf-wiki
// build pattern: POST kicks off a fire-and-forget job, GET polls the
// AppSetting-stashed status. Polling stops on done/error. While running the
// button is disabled and replaced by a progress bar.
interface ReextractAllStatus {
  state: "idle" | "running" | "done" | "error";
  at: string;
  total?: number;
  done?: number;
  current?: { id: string; title: string } | null;
  error?: string;
}

function ReextractAllRow() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["admin-book-metadata-reextract-all"],
    queryFn: async () => {
      const res = await fetch("/api/admin/book-metadata/reextract-all");
      if (!res.ok) throw new Error("Failed to load reextract status");
      return res.json() as Promise<ReextractAllStatus>;
    },
    // ponytail: poll only while running; stop on done/error/idle.
    refetchInterval: (query) =>
      query.state.data?.state === "running" ? 2000 : false,
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/book-metadata/reextract-all", {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to start");
      return json;
    },
    onSuccess: () => {
      toast.success("Re-extract all started");
      queryClient.invalidateQueries({
        queryKey: ["admin-book-metadata-reextract-all"],
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = statusQuery.data;
  const running = s?.state === "running";
  const pct =
    running && s?.total && s.total > 0
      ? Math.round(((s.done ?? 0) / s.total) * 100)
      : null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border bg-white p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Re-extract all
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => startMutation.mutate()}
        disabled={running || startMutation.isPending}
      >
        {running ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="mr-2 h-3.5 w-3.5" />
        )}
        {running ? "Running…" : "Re-extract every book"}
      </Button>
      {running && s && (
        <div className="flex min-w-[200px] flex-1 items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {s.done ?? 0}/{s.total ?? "?"}
          </span>
        </div>
      )}
      {running && s?.current && (
        <span className="w-full line-clamp-1 text-[11px] text-muted-foreground">
          Now: <span className="font-medium text-foreground">{s.current.title}</span>
        </span>
      )}
      {s?.state === "done" && (
        <span className="w-full text-[11px] text-green-600">
          Done — {s.done ?? 0} book{(s.done ?? 0) === 1 ? "" : "s"} re-extracted.
        </span>
      )}
      {s?.state === "error" && (
        <span className="w-full text-[11px] text-red-600">
          Failed after {s.done ?? 0} book{(s.done ?? 0) === 1 ? "" : "s"}: {s.error}
        </span>
      )}
      <p className="w-full text-[11px] text-muted-foreground">
        Runs the LLM extraction on every book sequentially. Each book takes a
        few seconds; progress is polled here.
      </p>
    </div>
  );
}
