'use client';

import { useEffect, useState } from 'react';
import type { NavItem } from '@likecoin/epub-ts';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TocEntryProps {
  item: NavItem;
  onNavigate: (href: string) => void;
  level?: number;
  currentHref?: string;
}

function TocEntry({ item, onNavigate, level = 0, currentHref }: TocEntryProps) {
  const isActive = currentHref ? item.href === currentHref : false;

  return (
    <div>
      <button
        onClick={() => onNavigate(item.href)}
        className={cn(
          'w-full text-left py-2 pr-4 text-sm transition-colors',
          isActive
            ? 'font-medium text-primary'
            : 'text-foreground hover:text-primary',
          level > 0 && 'border-l-2 border-border ml-4'
        )}
        style={{
          paddingLeft: level > 0 ? `${level * 16 + 16}px` : '16px',
        }}
      >
        {item.label}
      </button>
      {item.subitems && item.subitems.length > 0 && (
        <div>
          {item.subitems.map((child) => (
            <TocEntry
              key={child.id || child.href}
              item={child}
              onNavigate={onNavigate}
              level={level + 1}
              currentHref={currentHref}
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
}

export function TocPanel({ toc, currentHref, onNavigate }: TocPanelProps) {
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
          <Menu className="h-4 w-4" />
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
                />
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
