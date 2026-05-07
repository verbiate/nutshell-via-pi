"use client";

import { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ReaderChromeProps {
  bookTitle: string;
  onBack: () => void;
  tocTrigger: ReactNode;
  themeToggle: ReactNode;
  bookmarkTrigger?: ReactNode;
  bookmarkSaveTrigger?: ReactNode;
  searchTrigger?: ReactNode;
}

export function ReaderChrome({
  bookTitle,
  onBack,
  tocTrigger,
  themeToggle,
  bookmarkTrigger,
  bookmarkSaveTrigger,
  searchTrigger,
}: ReaderChromeProps) {
  return (
    <header
      className="absolute top-0 left-0 right-0 z-50 flex h-12 items-center justify-between px-3 sm:px-4 border-b border-border/50 bg-background/80 backdrop-blur-sm"
      role="banner"
    >
      {/* Left group: back + ToC + bookmark save + bookmarks */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back to library"
          className="shrink-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {tocTrigger}
        {bookmarkSaveTrigger}
        {bookmarkTrigger}
      </div>

      {/* Center: book title */}
      <span
        className="text-sm font-medium truncate max-w-[140px] sm:max-w-[400px] text-foreground"
        aria-label={`Book title: ${bookTitle}`}
      >
        {bookTitle}
      </span>

      {/* Right group: search + theme toggle */}
      <div className="flex items-center gap-1 shrink-0">
        {searchTrigger}
        {themeToggle}
      </div>
    </header>
  );
}
