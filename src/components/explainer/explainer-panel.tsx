"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  RotateCcw,
  Globe,
} from "lucide-react";
import { ExplainerStream } from "./explainer-stream";
import { LANGUAGES } from "@/lib/languages";

type ExplainerState =
  | "idle"
  | "loading"
  | "streaming"
  | "complete"
  | "error"
  | "empty";

interface ExplainerPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookId: string;
  type: "book" | "section" | "passage";
  sectionHref?: string;
  sectionTitle?: string;
  passageText?: string;
  passageCfi?: string;
  initialLanguage: string;
  onNavigateToCfi?: (cfi: string) => void;
}

export function ExplainerPanel({
  open,
  onOpenChange,
  bookId,
  type,
  sectionHref,
  sectionTitle,
  passageText,
  passageCfi,
  initialLanguage,
  onNavigateToCfi,
}: ExplainerPanelProps) {
  const [state, setState] = useState<ExplainerState>("idle");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState(initialLanguage);
  const [isCached, setIsCached] = useState(false);
  const [activeTab, setActiveTab] = useState("current");
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const title =
    type === "book"
      ? "Explainer"
      : type === "section"
        ? "Section Explainer"
        : "Passage Explainer";

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["explainer-history", bookId],
    queryFn: async () => {
      const res = await fetch(
        `/api/explainers/history?bookId=${encodeURIComponent(bookId)}`
      );
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
    enabled: open,
  });

  const generate = useCallback(async () => {
    setState("loading");
    setText("");
    setIsCached(false);

    // Check cache first
    try {
      let cacheRes: Response;
      if (type === "passage" && passageText) {
        cacheRes = await fetch("/api/explainers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId, type, language, passageText }),
        });
      } else {
        cacheRes = await fetch(
          `/api/explainers?bookId=${bookId}&type=${type}&lang=${language}&sectionHref=${sectionHref ?? ""}`
        );
      }
      if (cacheRes.ok) {
        const data = await cacheRes.json();
        if (data.cached) {
          setText(data.content);
          setIsCached(true);
          setState("complete");
          return;
        }
      }
    } catch {
      // Ignore cache check errors, proceed to generation
    }

    setState("streaming");
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/explainers/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          type,
          language,
          sectionHref,
          passageText,
        }),
        signal: abort.signal,
      });

      if (!res.body) {
        setState("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

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
              setState("error");
              return;
            }
            if (parsed.chunk) {
              fullText += parsed.chunk;
              setText(fullText);
            }
            if (parsed.cached) {
              setIsCached(true);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      setState("complete");
      queryClient.invalidateQueries({ queryKey: ["explainer-history", bookId] });
    } catch (err: any) {
      if (err.name === "AbortError") {
        setState("empty");
      } else {
        setState("error");
      }
    } finally {
      abortRef.current = null;
    }
  }, [bookId, type, language, sectionHref, passageText, queryClient]);

  const handleRetry = useCallback(() => {
    generate();
  }, [generate]);

  const handleLanguageChange = useCallback(
    (newLang: string) => {
      setLanguage(newLang);
      setState("idle");
      setText("");
      setIsCached(false);
      generate();
    },
    [generate]
  );

  // Auto-generate when sheet opens from idle state
  useEffect(() => {
    if (open && state === "idle") {
      generate();
    }
  }, [open, state, generate]);

  // Cancel on close
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort();
    }
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[320px] sm:w-[400px] p-0">
        <SheetHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-lav" />
            <SheetTitle className="text-base font-medium">{title}</SheetTitle>
            {isCached && state === "complete" && (
              <Badge variant="secondary" className="text-xs">
                Served from cache
              </Badge>
            )}
          </div>
          <Select value={language} onValueChange={handleLanguageChange}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <Globe className="h-3 w-3 mr-1" />
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
        </SheetHeader>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-2 mx-4 mt-3 mb-0">
            <TabsTrigger value="current">Current</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="current" className="mt-0">
            <ScrollArea className="h-[calc(100vh-120px)]">
              <div className="p-4">
                {state === "loading" && <ExplainerLoading />}
                {state === "error" && (
                  <ExplainerError onRetry={handleRetry} />
                )}
                {state === "empty" && <ExplainerEmpty />}
                {(state === "streaming" || state === "complete") && (
                  <ExplainerStream text={text} />
                )}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="history" className="mt-0">
            <ScrollArea className="h-[calc(100vh-120px)]">
              <div className="divide-y divide-border/50">
                {historyLoading && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Loading history...
                  </div>
                )}
                {!historyLoading &&
                  historyData?.explainers?.length === 0 && (
                    <div className="px-4 py-8 text-center">
                      <p className="font-medium text-foreground">
                        No Explainers yet
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Generate an Explainer for this book, a section, or a
                        selected passage.
                      </p>
                    </div>
                  )}
                {!historyLoading &&
                  historyData?.explainers?.map((entry: any) => (
                    <div key={entry.id} className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge
                          variant="outline"
                          className="text-[10px] h-5 capitalize"
                        >
                          {entry.contentType === "book"
                            ? "Book"
                            : entry.contentType === "section"
                              ? "Section"
                              : "Passage"}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="text-[10px] h-5 capitalize"
                        >
                          {entry.tier}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium text-foreground line-clamp-1">
                        {entry.targetLabel ||
                          (entry.contentType === "passage"
                            ? "Selected passage"
                            : "Explainer")}
                      </p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">
                          {entry.language.toUpperCase()} ·{" "}
                          {formatRelativeTime(entry.createdAt)}
                        </span>
                        {(entry.passageCfi || entry.sectionHref) &&
                          onNavigateToCfi && (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => {
                                onNavigateToCfi(
                                  entry.passageCfi || entry.sectionHref
                                );
                                onOpenChange(false);
                              }}
                            >
                              Go to context
                            </Button>
                          )}
                      </div>
                    </div>
                  ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function ExplainerLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <Loader2 className="h-6 w-6 animate-spin text-lav" />
      <p className="text-sm text-muted-foreground">Generating explanation...</p>
      <div className="flex gap-1">
        <span
          className="h-1.5 w-1.5 rounded-full bg-lav animate-bounce"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-lav animate-bounce"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-lav animate-bounce"
          style={{ animationDelay: "300ms" }}
        />
      </div>
    </div>
  );
}

function ExplainerError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
      <AlertCircle className="h-10 w-10 text-destructive" />
      <div>
        <h3 className="text-sm font-medium">Could not generate explanation</h3>
        <p className="mt-1 text-xs text-muted-foreground max-w-[240px]">
          There was a problem generating this explanation. Please try again.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw className="mr-2 h-3.5 w-3.5" />
        Try Again
      </Button>
    </div>
  );
}

function ExplainerEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
      <Sparkles className="h-10 w-10 text-muted-foreground/40" />
      <div>
        <h3 className="text-sm font-medium">No explanation yet</h3>
        <p className="mt-1 text-xs text-muted-foreground max-w-[240px]">
          Click &quot;Explain this to me&quot; to generate an AI explanation for this
          book.
        </p>
      </div>
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
