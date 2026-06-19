// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

import gsap from "gsap";
import { Bookshelf } from "../bookshelf";

// --- controllable IntersectionObserver stub -------------------------------
// happy-dom ships an IntersectionObserver, but its intersection maths don't
// fire deterministically. We swap in a stub that records the callback so the
// test can drive entries itself.
type IOEntry = { target: Element; isIntersecting: boolean };

class StubObserver {
  cb: (entries: IOEntry[]) => void;
  options: IntersectionObserverInit | undefined;
  observed = new Set<Element>();
  observe = vi.fn((el: Element) => {
    this.observed.add(el);
  });
  unobserve = vi.fn((el: Element) => {
    this.observed.delete(el);
  });
  disconnect = vi.fn();
  constructor(
    cb: (entries: IOEntry[]) => void,
    options?: IntersectionObserverInit,
  ) {
    this.cb = cb;
    this.options = options;
    // ponytail: module-level handle so tests can reach the live observer.
    lastObserver = this;
    observers.push(this);
  }
}

let lastObserver: StubObserver | null = null;
let observers: StubObserver[] = [];
let realIO: unknown;

// ponytail: with REAL gsap, ScrollTrigger auto-init spawns its own observers
// (rootMargin "200px") that overwrite `lastObserver`. The bookshelf reveal
// observer is the one whose rootMargin carries the "-10%" bottom inset
// (bookshelf.tsx:71), so select it explicitly.
function revealObserver(): StubObserver {
  const obs = observers.find(
    (o) => String(o.options?.rootMargin ?? "").includes("-10%"),
  );
  if (!obs) throw new Error("no reveal observer was created");
  return obs;
}

// --- helpers ---------------------------------------------------------------
function stubMatchMedia(queries: Record<string, boolean>) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((q: string) => ({
      matches: queries[q] ?? false,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// ponytail: matchMedia whose `change` listeners actually fire, so a runtime
// reduced-motion toggle propagates through useMediaQuery's subscription
// (stubMatchMedia above throws addEventListener away). Used by the C3 test.
function liveMatchMedia(initial: Record<string, boolean>) {
  type MqlEvent = { matches: boolean; media: string };
  const state = { ...initial };
  const listeners: Record<string, Set<(e: MqlEvent) => void>> = {};
  const mq = (q: string) => ({
    get matches() {
      return state[q] ?? false;
    },
    media: q,
    onchange: null,
    addEventListener: (_type: string, fn: (e: MqlEvent) => void) => {
      (listeners[q] ?? (listeners[q] = new Set())).add(fn);
    },
    removeEventListener: (_type: string, fn: (e: MqlEvent) => void) => {
      listeners[q]?.delete(fn);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((q: string) => mq(q)),
  });
  return {
    setMatches(q: string, val: boolean) {
      state[q] = val;
      for (const fn of listeners[q] ?? []) fn({ matches: val, media: q });
    },
  };
}

interface RenderHandle {
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
  rerender: (el: React.ReactElement) => void;
  unmount: () => void;
}

function render(el: React.ReactElement): RenderHandle {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return {
    container,
    root,
    rerender: (next: React.ReactElement) => {
      act(() => {
        root.render(next);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function book(id: string, title = "T") {
  return {
    id,
    title,
    author: "A",
    coverPath: "c",
    progress: null,
    hasProgress: false,
  } as any;
}

beforeEach(() => {
  lastObserver = null;
  observers = [];
  realIO = (window as any).IntersectionObserver;
  (window as any).IntersectionObserver = StubObserver;
  stubMatchMedia({ "(prefers-reduced-motion: reduce)": false });
  // No-op the tweeners so no async rAF animation runs; we assert call args only.
  vi.spyOn(gsap, "set").mockImplementation((() => ({})) as any);
  vi.spyOn(gsap, "to").mockImplementation((() => ({})) as any);
});

afterEach(() => {
  (window as any).IntersectionObserver = realIO;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ===========================================================================
// 1. SSR safety — renderToStaticMarkup runs no effects, so no animation.
// ===========================================================================
describe("Bookshelf scroll-reveal — SSR safety", () => {
  it("renders data-book-card markers and runs no animation during SSR", () => {
    const html = renderToStaticMarkup(
      <Bookshelf books={[book("b1"), book("b2")]} />,
    );
    expect((html.match(/data-book-card/g) || []).length).toBe(2);
    expect(gsap.set).not.toHaveBeenCalled();
    expect(gsap.to).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 2-3. Motion OK: setup hides cards, observes them, animates on enter.
// ===========================================================================
describe("Bookshelf scroll-reveal — motion OK", () => {
  it("hides each new [data-book-card] via gsap.set on mount", () => {
    const { container } = render(
      <Bookshelf books={[book("b1"), book("b2"), book("b3")]} />,
    );
    expect(gsap.set).toHaveBeenCalledTimes(1);
    const [targets, vars] = vi.mocked(gsap.set).mock.calls[0];
    expect((targets as Element[]).length).toBe(3);
    expect(vars).toEqual({ opacity: 0, y: 16 });
    // sanity: targets are exactly the card wrappers
    expect(container.querySelectorAll("[data-book-card]").length).toBe(3);
  });

  it("observes every card with IntersectionObserver", () => {
    render(<Bookshelf books={[book("b1"), book("b2")]} />);
    expect(lastObserver).not.toBeNull();
    expect(lastObserver!.observe).toHaveBeenCalledTimes(2);
  });

  it("animates intersecting cards in with the spec'd tween options", () => {
    const { container } = render(<Bookshelf books={[book("b1"), book("b2")]} />);
    const cards = container.querySelectorAll("[data-book-card]");
    act(() => {
      lastObserver!.cb([
        { target: cards[0], isIntersecting: true },
        { target: cards[1], isIntersecting: true },
      ]);
    });
    expect(gsap.to).toHaveBeenCalledTimes(1);
    const [targets, vars] = vi.mocked(gsap.to).mock.calls[0];
    expect((targets as Element[]).length).toBe(2);
    expect(vars).toMatchObject({
      opacity: 1,
      y: 0,
      duration: 0.5,
      ease: "power2.out",
      stagger: 0.04,
    });
  });

  it("animates a card only once (no reverse on re-intersection)", () => {
    const { container } = render(<Bookshelf books={[book("b1")]} />);
    const card = container.querySelector("[data-book-card]")!;
    act(() => lastObserver!.cb([{ target: card, isIntersecting: true }]));
    expect(gsap.to).toHaveBeenCalledTimes(1);
    expect(lastObserver!.unobserve).toHaveBeenCalledWith(card);
    // re-fire intersection for the same card — no second animation
    act(() => lastObserver!.cb([{ target: card, isIntersecting: true }]));
    expect(gsap.to).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 4. Reduced motion: no animation machinery at all.
// ===========================================================================
describe("Bookshelf scroll-reveal — reduced motion", () => {
  beforeEach(() => {
    stubMatchMedia({ "(prefers-reduced-motion: reduce)": true });
  });

  it("does not set up any animation", () => {
    render(<Bookshelf books={[book("b1"), book("b2")]} />);
    expect(gsap.set).not.toHaveBeenCalled();
    expect(gsap.to).not.toHaveBeenCalled();
    expect(lastObserver).toBeNull();
  });
});

// ===========================================================================
// 4b. Empty bookshelf (I6): the pending.length === 0 early return
// (bookshelf.tsx:46) must short-circuit before any gsap.set / observer
// wiring. Without that guard, gsap.set is invoked with an empty target list
// and an IntersectionObserver is constructed for nothing.
// ===========================================================================
describe("Bookshelf scroll-reveal — empty bookshelf (I6)", () => {
  it("sets up no animation machinery when there are no books", () => {
    render(<Bookshelf books={[]} />);
    expect(gsap.set).not.toHaveBeenCalled();
    expect(gsap.to).not.toHaveBeenCalled();
    expect(observers).toHaveLength(0);
  });
});

// ===========================================================================
// 5. Book-list change: the setup re-evaluates and observes new cards.
// ===========================================================================
describe("Bookshelf scroll-reveal — book-list changes", () => {
  it("re-evaluates when books change: newly added card is observed", () => {
    const { rerender, container } = render(<Bookshelf books={[book("b1")]} />);
    rerender(<Bookshelf books={[book("b1"), book("b2")]} />);
    const newCard = container.querySelectorAll("[data-book-card]")[1];
    expect(lastObserver!.observe).toHaveBeenCalledWith(newCard);
  });
});

// ===========================================================================
// 6. Cleanup: observer disconnects on unmount.
// ===========================================================================
describe("Bookshelf scroll-reveal — cleanup", () => {
  it("disconnects its observer on unmount", () => {
    const { unmount } = render(<Bookshelf books={[book("b1")]} />);
    const obs = lastObserver!;
    unmount();
    expect(obs.disconnect).toHaveBeenCalled();
  });
});

// ===========================================================================
// 7. Regression (C1 / C3): cards must stay visible across re-renders.
// These run REAL gsap (the shared beforeEach mocks gsap.set/to; we restore
// them here because the revertOnUpdate bug only surfaces on real tweens).
// ===========================================================================
describe("Bookshelf scroll-reveal — cards stay visible across re-renders (real gsap)", () => {
  beforeEach(() => {
    vi.mocked(gsap.set).mockRestore();
    vi.mocked(gsap.to).mockRestore();
    stubMatchMedia({ "(prefers-reduced-motion: reduce)": false });
  });

  // ponytail: regression for C1. revertOnUpdate:true made useGSAP fire
  // context.revert() on every books-ref change; context.revert() runs the
  // effect's returned cleanup (observer.disconnect), so the live reveal observer
  // was torn down and rebuilt on each router.refresh() from home-view.tsx:64 —
  // stranding already-revealed cards. We assert the contract the fix guarantees:
  // the observer is NOT disconnected on a books-ref change (without
  // revertOnUpdate, context.revert runs only on unmount).
  //
  // happy-dom can't surface the opacity symptom directly: the reveal gsap.to
  // runs in an async IntersectionObserver callback OUTSIDE the GSAP context (so
  // it is never reverted) and there is no rAF to advance it. The observer
  // teardown is the genuine observable effect of the buggy flag.
  it("does not disconnect the reveal observer when the books prop ref changes (C1)", () => {
    const { rerender } = render(<Bookshelf books={[book("b1")]} />);
    const obs = revealObserver();
    expect(obs.disconnect).not.toHaveBeenCalled();
    // new array identity, same book content — mirrors home-view's router.refresh()
    rerender(<Bookshelf books={[{ ...book("b1") }]} />);
    expect(obs.disconnect).not.toHaveBeenCalled();
  });

  // ponytail: regression for C3 — same root cause (revertOnUpdate) triggered by
  // a runtime reduced-motion toggle (false→true) instead of a books-ref change.
  it("does not disconnect the reveal observer when reduced-motion toggles on mid-flight (C3)", () => {
    const mm = liveMatchMedia({ "(prefers-reduced-motion: reduce)": false });
    render(<Bookshelf books={[book("b1")]} />);
    const obs = revealObserver();
    act(() => {
      mm.setMatches("(prefers-reduced-motion: reduce)", true);
    });
    expect(obs.disconnect).not.toHaveBeenCalled();
  });
});
