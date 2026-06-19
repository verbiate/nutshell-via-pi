"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Volume2, Loader2 } from "lucide-react";

export interface TtsTriggerProps {
  state: "idle" | "generating" | "disabled";
  onClick: () => void;
}

export function TtsTrigger({ state, onClick }: TtsTriggerProps) {
  const isGenerating = state === "generating";
  const isDisabled = state === "disabled";

  const tooltipText = isDisabled
    ? "Ask your admin to configure TTS"
    : isGenerating
    ? "Cancel audio generation"
    : "Start reading aloud";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            onClick={onClick}
            disabled={isDisabled}
            aria-label={isGenerating ? "Cancel audio generation" : "Read aloud"}
            className="h-[46px] w-[46px] shrink-0 bg-transparent text-foreground"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
}
