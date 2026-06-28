"use client";

import { useLayoutEffect, useRef } from "react";
import { HomeView } from "@/components/library/home-view";
import type { LibraryBook } from "@/types/book";

interface BookshelfSnapshotProps {
  books: LibraryBook[];
  userName: string | null;
  digestImage: string | null;
}

// ponytail: renders a static, non-interactive Bookshelf off-screen and clones
// it into SceneTransitionProvider's [data-scene-clone] layer. This provides
// the receding-library background during back-nav when the user deep-linked or
// refreshed the reader (no forward nav ever captured a clone) — see
// scene-transition.tsx back-nav branch, which finds the parked clone at
// layer.firstElementChild and animates it from RECEDE → FULL.
//
// The clone is plain DOM (no React ownership), so clearLayer()'s
// replaceChildren() is safe. The off-screen original is React-owned and is
// removed naturally on unmount.
//
// Ceiling: only mounts if the clone layer is currently empty — a forward-
// captured clone (bookshelf → reader nav) takes precedence and is left
// untouched, so the normal flow is unchanged. The snapshot reflects whatever
// books data it's given; ReaderClient re-fetches on back-click to keep the
// order fresh. A vertical resize between mount and back-nav stale the freeze's
// captured shelf-bar rect — same ceiling as the forward-captured clone (see
// freezeShelfBar comment in scene-transition.tsx).
export function BookshelfSnapshot({
  books,
  userName,
  digestImage,
}: BookshelfSnapshotProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const layer = document.querySelector<HTMLElement>("[data-scene-clone]");
    const container = containerRef.current;
    if (!layer || !container) return;
    // Don't clobber a forward-captured clone (normal bookshelf → reader flow).
    // The forward clone was captured at click time with the user's real scroll
    // and is the source of truth for the back animation.
    if (layer.childElementCount > 0) return;

    const clone = container.cloneNode(true) as HTMLElement;
    clone.setAttribute("data-snapshot", "");
    // Match the forward-clone's body-background fill so the dark stage doesn't
    // show through at the scaled edges during the recede (see scene-transition
    // :466-468 — same fill applied to forward clones).
    clone.style.backgroundColor = "var(--background)";
    clone.style.backgroundImage = "var(--field-bg)";
    clone.style.backgroundRepeat = "no-repeat";
    // Reset the off-screen positioning so the clone fills the layer normally.
    clone.style.position = "static";
    clone.style.visibility = "visible";
    clone.style.pointerEvents = "auto";
    clone.style.zIndex = "";
    layer.replaceChildren(clone);

    return () => {
      // Only remove if our clone is still in the layer (a later forward-nav,
      // back-arrival, or a fresh re-render may have already cleared it).
      if (layer.firstElementChild === clone) {
        layer.replaceChildren();
      }
    };
  }, [books, userName, digestImage]);

  // ponytail: static avatar placeholder. Real UserNav has session/query hooks
  // and a dropdown — too much to render off-tree for a 0.8s slide-out where
  // the reader's box-shadow covers the header anyway.
  const initials =
    userName
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U";

  return (
    <div
      ref={containerRef}
      data-scene="library"
      aria-hidden="true"
      className="flex min-h-screen flex-col pt-12 lg:h-screen lg:overflow-hidden"
      style={{
        position: "absolute",
        inset: 0,
        visibility: "hidden",
        pointerEvents: "none",
      }}
    >
      <header className="mx-auto flex h-16 w-full shrink-0 max-w-[1536px] items-center justify-between px-8 lg:px-14">
        <img
          src="/images/nutshell_logo_chocolate.svg"
          alt=""
          className="h-8 w-auto"
        />
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
            {initials}
          </div>
        </div>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-[1536px] flex-1 flex-col px-8 py-8 lg:pb-0">
        <HomeView
          static
          userName={userName}
          books={books}
          digestImage={digestImage}
        />
      </main>
    </div>
  );
}
