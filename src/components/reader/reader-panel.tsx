"use client";

import { useState } from "react";
import type { NavItem } from "@likecoin/epub-ts";
import { BookOpen, Headphones, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExplainerPanel } from "@/components/explainer/explainer-panel";

// ponytail: placeholder gradients mirrored from book-card.tsx so covers match the shelf.
const PLACEHOLDER_COVERS = [
  "bg-[linear-gradient(150deg,#3b6ea5,#21456e)]",
  "bg-[linear-gradient(150deg,#1c1c22,#3a2740)]",
  "bg-[linear-gradient(150deg,#2a7d6f,#1c4a42)]",
  "bg-[linear-gradient(150deg,#6b4a8a,#3a2740)]",
  "bg-[linear-gradient(150deg,#b5563a,#6e2f1f)]",
];

function getPlaceholderCover(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  return PLACEHOLDER_COVERS[Math.abs(hash) % PLACEHOLDER_COVERS.length];
}

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
          <Lightbulb className="h-3.5 w-3.5 text-lav" />
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

export interface ReaderPanelProps {
  bookId: string;
  bookTitle: string;
  author?: string | null;
  coverPath?: string | null;
  language?: string;
  toc: NavItem[];
  currentHref: string;
  onNavigate: (href: string) => void;
  initialLanguage: string;
  onListenFromHere: () => void;
  isAdmin?: boolean;
  bookCreatedAt?: string;
}

export function ReaderPanel({
  bookId,
  bookTitle,
  author,
  coverPath,
  language,
  toc,
  currentHref,
  onNavigate,
  initialLanguage,
  onListenFromHere,
  isAdmin,
  bookCreatedAt,
}: ReaderPanelProps) {
  const [bookExplainerOpen, setBookExplainerOpen] = useState(false);
  const showLang = !!language && language !== "und";

  return (
    <div className="flex flex-col">
      {/* Book details card */}
      <div className="flex gap-3 px-5 py-4">
        <div className="relative aspect-[3/4] h-[88px] shrink-0 overflow-hidden rounded-md bg-paper-deep shadow-sm">
          {coverPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/${coverPath}`}
              alt={bookTitle}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className={cn(
                "flex h-full w-full items-center justify-center",
                getPlaceholderCover(bookTitle)
              )}
            >
              <BookOpen className="h-5 w-5 text-white/50" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-[15px] font-medium leading-tight text-foreground line-clamp-3">
            {bookTitle}
          </h3>
          {author && (
            <p className="mt-1 text-xs text-muted-foreground truncate">
              {author}
            </p>
          )}
          {showLang && (
            <span className="mt-2 inline-block rounded-full bg-paper-deep px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
              {language}
            </span>
          )}
          {isAdmin && bookCreatedAt && (
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              Uploaded {new Date(bookCreatedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {/* Action row */}
      <div className="flex gap-2 px-5 pb-4">
        <Button
          size="sm"
          className="flex-1 gap-1.5"
          onClick={onListenFromHere}
        >
          <Headphones className="h-3.5 w-3.5" />
          Listen from here
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5"
          onClick={() => setBookExplainerOpen(true)}
        >
          <Lightbulb className="h-3.5 w-3.5 text-lav" />
          Ask the book
        </Button>
      </div>
      <ExplainerPanel
        open={bookExplainerOpen}
        onOpenChange={setBookExplainerOpen}
        bookId={bookId}
        type="book"
        initialLanguage={initialLanguage}
      />

      {/* Table of contents */}
      {toc.length > 0 && (
        <div className="border-t border-line">
          <div className="px-5 pt-3 pb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Contents
            </p>
          </div>
          <div className="py-1">
            {toc.map((item) => (
              <TocEntry
                key={item.id || item.href}
                item={item}
                onNavigate={onNavigate}
                level={0}
                currentHref={currentHref}
                bookId={bookId}
                initialLanguage={initialLanguage}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
