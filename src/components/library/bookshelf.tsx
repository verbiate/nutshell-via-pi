"use client";

import * as React from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { BookCard } from "./book-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LibraryBook } from "@/types/book";

interface BookshelfProps {
  books: LibraryBook[];
}

export function Bookshelf({ books }: BookshelfProps) {
  const reducedMotion = usePrefersReducedMotion();
  const containerRef = React.useRef<HTMLDivElement>(null);

  // ponytail: IntersectionObserver + gsap.to, deliberately NOT ScrollTrigger.batch.
  // Bookshelf's effect runs child-first, before SmoothScrollArea registers its
  // scrollerProxy, and ScrollTrigger defaults its scroller to `window` unless
  // `vars.scroller` is passed (ScrollTrigger.js:616) — which would need a ref to
  // the viewport we don't own. IntersectionObserver observes viewport intersection
  // directly (the nested scroller still moves cards relative to the viewport), so
  // this is fully self-contained with no coordination with SmoothScrollArea.
  useGSAP(
    () => {
      // ponytail: read matchMedia directly here, not just the hook.
      // usePrefersReducedMotion is lazy — it returns false until its passive
      // effect runs (after this layout effect), so the hook alone would hide
      // cards on the first pre-paint pass even under reduced motion. The direct
      // read is accurate now; the hook stays in `dependencies` so a runtime
      // preference change still re-triggers. OR = err toward no animation.
      const prefersReduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (reducedMotion || prefersReduced) return;
      const container = containerRef.current;
      if (!container) return;

      const pending = Array.from(
        container.querySelectorAll<HTMLElement>(
          "[data-book-card]:not([data-animated])",
        ),
      );
      if (pending.length === 0) return;

      // ponytail: set the hidden start-state in the layout-effect phase (before
      // paint) so above-the-fold cards never flash visible-then-hidden.
      gsap.set(pending, { opacity: 0, y: 16 });

      const observer = new IntersectionObserver(
        (entries) => {
          const entering = entries
            .filter((e) => e.isIntersecting)
            .map((e) => e.target as HTMLElement)
            .filter((el) => !el.hasAttribute("data-animated"));
          if (entering.length === 0) return;
          for (const el of entering) {
            el.setAttribute("data-animated", "");
            observer.unobserve(el);
          }
          gsap.to(entering, {
            opacity: 1,
            y: 0,
            duration: 0.5,
            ease: "power2.out",
            stagger: 0.04,
          });
        },
        { rootMargin: "0px 0px -10% 0px" },
      );
      pending.forEach((el) => observer.observe(el));

      return () => observer.disconnect();
    },
    {
      scope: containerRef,
      dependencies: [books, reducedMotion],
      // ponytail: revertOnUpdate removed — context.revert() otherwise fired on
      // every books-ref change (home-view's router.refresh hands down a new
      // array each mount) and on every reduced-motion toggle, tearing down the
      // reveal observer mid-flight. Revert now runs only on unmount; already-
      // revealed cards (data-animated) keep their state and new pending cards
      // are observed on the next run.
    },
  );

  return (
    <div
      ref={containerRef}
      className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] items-end gap-x-5 gap-y-6 px-12"
    >
      {books.map((book) => (
        <div key={book.id} data-book-card>
          <BookCard
            id={book.id}
            title={book.title}
            author={book.author}
            coverPath={book.coverPath}
            progress={book.progress}
            hasProgress={book.hasProgress}
          />
        </div>
      ))}
    </div>
  );
}

export function BookshelfSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] items-end gap-x-5 gap-y-6 px-12">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[3/4] w-full rounded-md" />
          <div className="mt-2 h-1.5 w-full" />
        </div>
      ))}
    </div>
  );
}
