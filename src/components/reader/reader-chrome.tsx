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
  hidden?: boolean;
  onHideControls?: () => void;
}

export function ReaderChrome({
  onBack,
  searchTrigger,
  ttsTrigger,
  sidebarOpen = false,
  hidden = false,
  onHideControls,
}: ReaderChromeProps) {
  return (
    <header
      className={cn(
        // ponytail: full viewport width when closed (right-0) so the right group sits 48px from the
        // viewport edge; pointer-events-none on the header keeps the rail below clickable.
        "absolute top-12 left-0 right-0 z-50 flex h-12 items-center justify-between px-12 pointer-events-none transition-[right] duration-[var(--reader-dur)] ease-reader transition-opacity",
        sidebarOpen
          ? "sm:right-[calc(var(--reader-rail-w)+var(--reader-sidebar-w)+48px)]"
          : "",
        hidden && "opacity-0",
      )}
      role="banner"
      aria-hidden={hidden}
    >
      <div className={cn("flex items-center", hidden ? "pointer-events-none" : "pointer-events-auto")}>
        <Button
          onClick={onBack}
          aria-label="Back to bookshelf"
          tabIndex={hidden ? -1 : 0}
          className="h-[46px] bg-transparent text-foreground"
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          Bookshelf
        </Button>
      </div>

      {/* ponytail: container keeps gap-1, leaving a 4px residue after collapse — acceptable per spec */}
      <div className={cn("flex items-center gap-1 shrink-0", hidden ? "pointer-events-none" : "pointer-events-auto")}>
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
              tabIndex={sidebarOpen && !hidden ? 0 : -1}
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
