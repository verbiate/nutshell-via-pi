"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Lightbulb, Loader2 } from "lucide-react";
import { ExplainerPanel } from "./explainer-panel";

interface ExplainerTriggerProps {
  bookId: string;
  initialLanguage: string;
}

export function ExplainerTrigger({ bookId, initialLanguage }: ExplainerTriggerProps) {
  const [open, setOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          setIsGenerating(true);
        }}
        disabled={isGenerating && open}
      >
        {isGenerating && open ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-lav" />
        ) : (
          <Lightbulb className="mr-2 h-4 w-4 text-lav" />
        )}
        {isGenerating && open ? "Generating..." : "Explain this to me"}
      </Button>
      <ExplainerPanel
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setIsGenerating(false);
        }}
        bookId={bookId}
        type="book"
        initialLanguage={initialLanguage}
      />
    </>
  );
}
