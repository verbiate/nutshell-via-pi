"use client";

import * as React from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";
import {
  computeThumbHeight,
  computeThumbTranslateY,
  scrollFromDrag,
} from "./scrollbar-math";

const DESKTOP_QUERY = "(min-width: 1024px)";

interface SmoothScrollAreaProps {
  children: React.ReactNode;
  className?: string;
}

export interface SmoothScrollAreaHandle {
  scrollTo(target: number | HTMLElement, opts?: { immediate?: boolean }): void;
  rootElement: HTMLDivElement | null;
}

export const SmoothScrollArea = React.forwardRef<SmoothScrollAreaHandle, SmoothScrollAreaProps>(
function SmoothScrollArea({
  children,
  className,
}: SmoothScrollAreaProps, ref): React.JSX.Element {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reducedMotion = usePrefersReducedMotion();

  const viewportRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const thumbRef = React.useRef<HTMLDivElement>(null);
  const lenisRef = React.useRef<Lenis | null>(null);
  const fadeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = React.useRef<{
    startY: number;
    startScroll: number;
    startThumbTop: number;
  } | null>(null);

  // ponytail: thumb height/translateY are written straight to the DOM on every
  // scroll frame (see updateThumbPosition). Putting them in React state would
  // re-render the unmemoized Bookshelf child (50–500 books) 60×/sec (I3). Only
  // thumbVisible (rare fade transitions) stays in state.
  const thumbTranslateYRef = React.useRef(0);
  const [thumbVisible, setThumbVisible] = React.useState(false);

  const wire = isDesktop && !reducedMotion;

  const updateThumbPosition = React.useCallback((scrollTop: number) => {
    const viewport = viewportRef.current;
    const thumb = thumbRef.current;
    if (!viewport || !thumb) return;
    const { scrollHeight, clientHeight } = viewport;
    const height = computeThumbHeight({ clientHeight, scrollHeight });
    const translateY = computeThumbTranslateY({
      scrollTop,
      scrollHeight,
      clientHeight,
      thumbHeight: height,
    });
    thumb.style.height = `${height}px`;
    thumb.style.transform = `translateY(${translateY}px)`;
    thumbTranslateYRef.current = translateY;
  }, []);

  const showThumbTemporarily = React.useCallback(() => {
    setThumbVisible(true);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => setThumbVisible(false), 1000);
  }, []);

  // ponytail: clear the pending fade timer on unmount so it can't fire
  // setThumbVisible(false) on a gone component (leak + potential state warning).
  React.useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  React.useImperativeHandle(ref, () => ({
    scrollTo(target: number | HTMLElement, opts?: { immediate?: boolean }) {
      const lenis = lenisRef.current;
      if (lenis) {
        lenis.scrollTo(target, opts);
      } else {
        const viewport = viewportRef.current;
        if (!viewport) return;
        if (typeof target === "number") {
          viewport.scrollTop = target;
        } else {
          const targetRect = target.getBoundingClientRect();
          const viewportRect = viewport.getBoundingClientRect();
          viewport.scrollTop = targetRect.top - viewportRect.top + viewport.scrollTop;
        }
      }
    },
    get rootElement(): HTMLDivElement | null {
      return viewportRef.current;
    },
  }), []);

  useGSAP(
    () => {
      if (!wire || !viewportRef.current) return;
      const viewport = viewportRef.current;

      const lenis = new Lenis({
        wrapper: viewport,
        content: contentRef.current!,
        smoothWheel: true,
        lerp: 0.1,
      });
      lenisRef.current = lenis;

      lenis.on("scroll", (e: Lenis) => {
        updateThumbPosition(e.scroll);
        showThumbTemporarily();
      });

      // ponytail: no ScrollTrigger.scrollerProxy / normalizeScroll here — the
      // bookshelf reveal uses IntersectionObserver + gsap.to (bookshelf.tsx:19),
      // which reads viewport.scrollTop directly and never goes through ST's
      // scroller abstraction. scrollerProxy + ScrollTrigger.update/refresh were
      // dead wiring, and normalizeScroll(false) was a leaky global side effect.

      const tickerFn = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tickerFn);
      gsap.ticker.lagSmoothing(0);

      return () => {
        gsap.ticker.remove(tickerFn);
        lenis.destroy();
        lenisRef.current = null;
      };
    },
    { scope: viewportRef, dependencies: [wire], revertOnUpdate: true },
  );

  if (!isDesktop || reducedMotion) {
    // ponytail: no .smooth-scroll-area here — that class hides the native
    // scrollbar (globals.css:347-353); mobile + reduced-motion users need it
    // as their only affordance. The scroll div carries overflow-y-auto +
    // h-full so the reader sidebar (fixed-height flex child at 640–1023px)
    // gets a proper scroll container. On the bookshelf (normal flow, no
    // explicit parent height), h-full resolves to auto and overflow-y-auto
    // never triggers — the page scrolls, as before.
    return (
      <div ref={viewportRef} className={cn("h-full overflow-y-auto", className)}>
        {children}
      </div>
    );
  }

  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lenisRef.current) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      startY: e.clientY,
      startScroll: lenisRef.current.scroll,
      startThumbTop: thumbTranslateYRef.current,
    };
    setThumbVisible(true);
  };

  const onThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    const viewport = viewportRef.current;
    const lenis = lenisRef.current;
    if (!drag || !track || !thumb || !viewport || !lenis) return;
    const deltaY = e.clientY - drag.startY;
    const trackHeight = track.clientHeight;
    const tHeight = thumb.offsetHeight;
    const travel = trackHeight - tHeight;
    const newThumbTop = Math.min(travel, Math.max(0, drag.startThumbTop + deltaY));
    const dragRatio = travel > 0 ? newThumbTop / travel : 0;
    const target = scrollFromDrag({
      dragRatio,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
    });
    lenis.scrollTo(target, { immediate: true });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    showThumbTemporarily();
  };

  return (
    // ponytail: outer wrapper is the positioning context for the track; the
    // viewport (overflow-y-auto) is a sibling, NOT the track's parent. An
    // absolutely-positioned track inside a scroll container scrolls WITH
    // the content (its containing block scrolls), which was why the thumb
    // appeared not to move with scroll. Sibling-structure fixes that.
    <div
      data-smooth-scroll-root
      className={cn("relative h-full", className)}
    >
      <div
        ref={viewportRef}
        className="smooth-scroll-area h-full overflow-y-auto"
      >
        <div ref={contentRef} data-scroll-content className="lenis-content">
          {children}
        </div>
      </div>
      <div
        ref={trackRef}
        data-scrollbar-track
        className="pointer-events-none absolute right-1 top-2 bottom-2 w-1.5 z-10"
        style={{
          opacity: thumbVisible ? 1 : 0,
          transition: "opacity 300ms ease-out",
        }}
        onPointerEnter={() => setThumbVisible(true)}
        onPointerLeave={() => showThumbTemporarily()}
      >
        <div
          ref={thumbRef}
          data-scrollbar-thumb
          className="pointer-events-auto absolute left-0 right-0 rounded-full bg-ink/30"
          onPointerDown={onThumbPointerDown}
          onPointerMove={onThumbPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
    </div>
  );
}
);
