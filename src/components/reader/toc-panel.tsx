"use client";

import { useEffect, useState } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExplainerPanel } from "@/components/explainer/explainer-panel";

interface TocEntryProps {
  item: NavItem;
  onNavigate: (href: string) => void;
  level?: number;
  currentHref?: string;
  bookId: string;
  initialLanguage: string;
}

function TocEntry({
  item,
  onNavigate,
  level = 0,
  currentHref,
  bookId,
  initialLanguage,
}: TocEntryProps) {
  const isActive = currentHref ? item.href === currentHref : false;
  const [explainerOpen, setExplainerOpen] = useState(false);

  return (
    <div>
      <div className="group flex items-center">
        <button
          onClick={() => onNavigate(item.href)}
          className={cn(
            "flex-1 text-left py-2 pr-4 text-sm transition-colors",
            isActive
              ? "font-medium text-primary"
              : "text-foreground hover:text-primary",
            level > 0 && "border-l-2 border-border ml-4"
          )}
          style={{
            paddingLeft: level > 0 ? `${level * 16 + 16}px` : "16px",
          }}
        >
          {item.label}
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setExplainerOpen(true);
          }}
          aria-label={`Explain section: ${item.label}`}
        >
          <Sparkles className="h-3.5 w-3.5 text-lav" />
        </Button>
      </div>
      <ExplainerPanel
        open={explainerOpen}
        onOpenChange={setExplainerOpen}
        bookId={bookId}
        type="section"
        sectionHref={item.href}
        sectionTitle={item.label}
        initialLanguage={initialLanguage}
      />
      {item.subitems && item.subitems.length > 0 && (
        <div>
          {item.subitems.map((child) => (
            <TocEntry
              key={child.id || child.href}
              item={child}
              onNavigate={onNavigate}
              level={level + 1}
              currentHref={currentHref}
              bookId={bookId}
              initialLanguage={initialLanguage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export interface TocPanelProps {
  toc: NavItem[];
  currentHref?: string;
  onNavigate: (href: string) => void;
  bookId: string;
  initialLanguage: string;
}

export function TocPanel({
  toc,
  currentHref,
  onNavigate,
  bookId,
  initialLanguage,
}: TocPanelProps) {
  const [open, setOpen] = useState(false);

  const handleNavigate = (href: string) => {
    onNavigate(href);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open table of contents"
        >
          {/* raw lucide icon to avoid size override */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" x2="21" y1="6" y2="6" />
            <line x1="3" x2="21" y1="12" y2="12" />
            <line x1="3" x2="21" y1="18" y2="18" />
          </svg>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[320px] sm:w-[360px] p-0">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle>Table of Contents</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-56px)]">
          <div className="py-2">
            {toc.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No table of contents</p>
                <p className="mt-1">
                  This book does not contain a navigable table of contents.
                </p>
              </div>
            ) : (
              toc.map((item) => (
                <TocEntry
                  key={item.id || item.href}
                  item={item}
                  onNavigate={handleNavigate}
                  level={0}
                  currentHref={currentHref}
                  bookId={bookId}
                  initialLanguage={initialLanguage}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
