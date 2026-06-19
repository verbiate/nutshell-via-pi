"use client";

import { ReactNode } from "react";
import { ChevronLeft, PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ReaderChromeProps {
  onBack: () => void;
  searchTrigger?: ReactNode;
  ttsTrigger?: ReactNode;
  sidebarOpen?: boolean;
  onHideControls?: () => void;
}

export function ReaderChrome({
  onBack,
  searchTrigger,
  ttsTrigger,
  sidebarOpen = false,
  onHideControls,
}: ReaderChromeProps) {
  return (
    <header
      className={cn(
        "absolute top-0 left-0 z-50 flex h-12 items-center justify-between px-4 transition-[right] duration-[var(--reader-dur)] ease-reader sm:px-6",
        sidebarOpen
          ? "sm:right-[calc(var(--reader-rail-w)+var(--reader-sidebar-w))]"
          : "sm:right-[var(--reader-rail-w)]",
      )}
      role="banner"
    >
      <div className="flex items-center">
        {sidebarOpen ? (
          <Button
            onClick={onBack}
            aria-label="Back to bookshelf"
            className="h-[46px] bg-transparent text-foreground"
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Bookshelf
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Back to library"
            className="shrink-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* ponytail: container keeps gap-1, leaving a 4px residue after collapse — acceptable per spec */}
      <div className="flex items-center gap-1 shrink-0">
        {searchTrigger}
        {ttsTrigger}
        <div
          aria-hidden={!sidebarOpen}
          className={cn(
            "grid transition-all duration-[var(--reader-dur)] ease-reader",
            sidebarOpen ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0 pointer-events-none",
          )}
        >
          <div className="overflow-hidden">
            <Button
              onClick={onHideControls}
              tabIndex={sidebarOpen ? 0 : -1}
              aria-label="Hide controls"
              className="h-[46px] bg-transparent text-foreground"
            >
              <PanelRightClose className="mr-2 h-4 w-4" />
              Hide controls
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
