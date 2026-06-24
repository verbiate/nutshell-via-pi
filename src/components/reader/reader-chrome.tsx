"use client";

import { ReactNode } from "react";
import { ChevronLeft, PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ReaderChromeProps {
  onBack: () => void;
  searchTrigger?: ReactNode;
  sidebarOpen?: boolean;
  hidden?: boolean;
  onHideControls?: () => void;
}

export function ReaderChrome({
  onBack,
  searchTrigger,
  sidebarOpen = false,
  hidden = false,
  onHideControls,
}: ReaderChromeProps) {
  return (
    <header
      className={cn(
        // ponytail: full viewport width when closed (right-0) so the right group sits 48px from the
        // viewport edge; pointer-events-none on the header keeps the rail below clickable.
        // ponytail: pr-0 when open neutralizes the px-12 right padding so the right group
        // sits flush at the header's right edge (already 48px from the sidebar) — matches
        // Bookshelf's 48px from the viewport-left wall. All three animatable properties share
        // one transition declaration: two transition-* classes would both set transition-property
        // and the cascade silently kills one — that made right/pr snap on close while the
        // collapsing Hide-controls button overshot its target width.
        "absolute top-12 left-0 right-0 z-50 flex h-12 items-center justify-between px-12 pointer-events-none transition-[right,padding-right,opacity] duration-[var(--reader-dur)] ease-reader",
        sidebarOpen
          ? "sm:right-[calc(var(--reader-rail-w)+var(--reader-sidebar-w)+48px)] sm:pr-0"
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
