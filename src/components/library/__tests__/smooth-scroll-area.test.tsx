// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

// --- module mocks (hoisted) ---
// ponytail: real gsap + real useGSAP run in happy-dom; only Lenis is mocked.
// gsap.ticker.add/remove are spied per-test.
const { lenisCtor } = vi.hoisted(() => ({
  // ponytail: regular function (not arrow) so the mock is constructable via `new`.
  lenisCtor: vi.fn(function (this: any, opts: unknown) {
    this.on = vi.fn();
    this.scroll = 0;
    this.scrollTo = vi.fn();
    this.destroy = vi.fn();
    this.raf = vi.fn();
    this.__opts = opts;
  }),
}));

vi.mock("lenis", () => ({ default: lenisCtor }));

import gsap from "gsap";
import { SmoothScrollArea } from "../smooth-scroll-area";
import { scrollFromDrag } from "../scrollbar-math";

// --- helpers ---
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

// Reset mock call history + restore spied gsap methods between tests.
beforeEach(() => {
  vi.spyOn(gsap.ticker, "add");
  vi.spyOn(gsap.ticker, "remove");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// =====================================================================
// Group A — SSR safety (renderToStaticMarkup runs no effects, so the
// component renders its initial passthrough branch: no smooth-scroll-area
// class, no thumb, children present).
// =====================================================================
describe("SmoothScrollArea — SSR safety", () => {
  it("does not throw when rendered to static markup", () => {
    expect(() =>
      renderToStaticMarkup(
        <SmoothScrollArea>
          <div data-testid="kid">child-content</div>
        </SmoothScrollArea>,
      ),
    ).not.toThrow();
  });

  it("includes the children in the SSR output", () => {
    const html = renderToStaticMarkup(
      <SmoothScrollArea>
        <div data-testid="kid">child-content</div>
      </SmoothScrollArea>,
    );
    expect(html).toContain("child-content");
  });

  it("does not emit the smooth-scroll-area class before mount", () => {
    const html = renderToStaticMarkup(
      <SmoothScrollArea>
        <div data-testid="kid">child-content</div>
      </SmoothScrollArea>,
    );
    expect(html).not.toContain("smooth-scroll-area");
  });
});

// =====================================================================
// Group B — Desktop markup (min-width:1024px true, motion ok).
// =====================================================================
describe("SmoothScrollArea — desktop markup", () => {
  beforeEach(() => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": false,
    });
  });

  it("renders a viewport with the smooth-scroll-area class", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(container.querySelector(".smooth-scroll-area")).not.toBeNull();
  });

  it("renders a track element with data-scrollbar-track", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(container.querySelector("[data-scrollbar-track]")).not.toBeNull();
  });

  it("renders a thumb element with data-scrollbar-thumb", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(container.querySelector("[data-scrollbar-thumb]")).not.toBeNull();
  });

  it("passes className through to the viewport", () => {
    const { container } = render(
      <SmoothScrollArea className="custom-prop-x">
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const viewport = container.querySelector(
      ".smooth-scroll-area",
    ) as HTMLElement;
    expect(viewport.classList.contains("custom-prop-x")).toBe(true);
  });
});

// =====================================================================
// Group C — Mobile gate (min-width:1024px false → passthrough).
// =====================================================================
describe("SmoothScrollArea — mobile gate", () => {
  beforeEach(() => {
    stubMatchMedia({
      "(min-width: 1024px)": false,
      "(prefers-reduced-motion: reduce)": false,
    });
  });

  it("does not render the smooth-scroll-area viewport", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(container.querySelector(".smooth-scroll-area")).toBeNull();
  });

  it("does not render the pseudo-scrollbar track", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(container.querySelector("[data-scrollbar-track]")).toBeNull();
  });

  it("still renders the children", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div data-testid="kid">mobile-child</div>
      </SmoothScrollArea>,
    );
    expect(container.querySelector("[data-testid='kid']")).not.toBeNull();
  });
});

// =====================================================================
// Group D — Reduced motion gate (desktop + prefers-reduced-motion:reduce).
// =====================================================================
describe("SmoothScrollArea — reduced motion gate", () => {
  beforeEach(() => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": true,
    });
  });

  it("does not apply the scrollbar-hiding smooth-scroll-area class under reduced motion (C2)", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    // .smooth-scroll-area hides the native scrollbar (globals.css:347-353);
    // reduced-motion users rely on the native scrollbar, so the class must be
    // absent from this branch.
    expect(container.querySelector(".smooth-scroll-area")).toBeNull();
  });

  it("keeps native scrolling via overflow-y-auto", () => {
    const { container } = render(
      <SmoothScrollArea className="rm-viewport">
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const viewport = container.querySelector(".rm-viewport") as HTMLElement;
    expect(viewport.classList.contains("overflow-y-auto")).toBe(true);
  });

  it("does not render the pseudo-scrollbar track", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(container.querySelector("[data-scrollbar-track]")).toBeNull();
  });

  it("does not construct Lenis", () => {
    render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(lenisCtor).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Group E — Lenis wiring (desktop, motion ok; mocked lenis; real gsap
// ticker spied).
// =====================================================================
describe("SmoothScrollArea — Lenis wiring", () => {
  beforeEach(() => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": false,
    });
  });

  it("runs the GSAP wiring after mount (constructs Lenis)", () => {
    render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(lenisCtor).toHaveBeenCalled();
  });

  it("constructs Lenis with wrapper set to the viewport element", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(lenisCtor).toHaveBeenCalled();
    const viewport = container.querySelector(".smooth-scroll-area");
    const opts = lenisCtor.mock.calls[0]?.[0] as { wrapper?: unknown };
    expect(opts.wrapper).toBe(viewport);
  });

  it("subscribes to lenis scroll events", () => {
    render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(lenisCtor).toHaveBeenCalled();
    const inst = lenisCtor.mock.results[0]?.value as {
      on: ReturnType<typeof vi.fn>;
    };
    expect(inst.on).toHaveBeenCalledWith("scroll", expect.any(Function));
  });

  it("adds the lenis raf callback to the gsap ticker", () => {
    render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(lenisCtor).toHaveBeenCalled();
    expect(gsap.ticker.add).toHaveBeenCalledWith(expect.any(Function));
  });

  it("destroys Lenis on unmount", () => {
    const { unmount } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(lenisCtor).toHaveBeenCalled();
    const inst = lenisCtor.mock.results[0]?.value as {
      destroy: ReturnType<typeof vi.fn>;
    };
    unmount();
    expect(inst.destroy).toHaveBeenCalled();
  });

  it("removes the same ticker function that was added on unmount", () => {
    const { unmount } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    expect(gsap.ticker.add).toHaveBeenCalled();
    const addedFn = vi.mocked(gsap.ticker.add).mock.calls[0]?.[0];
    unmount();
    expect(gsap.ticker.remove).toHaveBeenCalledWith(addedFn);
  });
});

// =====================================================================
// Group G — Content wrapper. Desktop + motion OK renders an explicit
// [data-scroll-content] wrapper that Lenis targets instead of
// viewport.firstElementChild; mobile + reduced-motion bypass it.
// =====================================================================
describe("SmoothScrollArea — content wrapper", () => {
  it("renders a [data-scroll-content] element containing the children (desktop)", () => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": false,
    });
    const { container } = render(
      <SmoothScrollArea>
        <div data-testid="kid">kid-content</div>
      </SmoothScrollArea>,
    );
    const wrapper = container.querySelector("[data-scroll-content]");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("[data-testid='kid']")).not.toBeNull();
  });

  it("passes the [data-scroll-content] element as Lenis content option", () => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": false,
    });
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const wrapper = container.querySelector("[data-scroll-content]");
    const opts = lenisCtor.mock.calls[0]?.[0] as { content?: unknown };
    expect(opts.content).toBe(wrapper);
  });

  // Guards: these branches must NOT gain a content wrapper.
  it("does not render [data-scroll-content] on mobile (children render directly)", () => {
    stubMatchMedia({
      "(min-width: 1024px)": false,
      "(prefers-reduced-motion: reduce)": false,
    });
    const { container } = render(
      <SmoothScrollArea>
        <div data-testid="kid">mobile-kid</div>
      </SmoothScrollArea>,
    );
    expect(container.querySelector("[data-scroll-content]")).toBeNull();
    expect(container.querySelector("[data-testid='kid']")).not.toBeNull();
  });

  it("does not render [data-scroll-content] under reduced motion", () => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": true,
    });
    const { container } = render(
      <SmoothScrollArea>
        <div data-testid="kid">reduced-kid</div>
      </SmoothScrollArea>,
    );
    expect(container.querySelector("[data-scroll-content]")).toBeNull();
    expect(container.querySelector("[data-testid='kid']")).not.toBeNull();
  });
});

// ponytail: bubbles+cancelable so React's root-level delegation + preventDefault work.
function firePointer(el: Element, type: string, opts: PointerEventInit = {}) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        ...opts,
      }),
    );
  });
}

function stubDim(
  el: Element,
  props: Record<string, number>,
) {
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(el, k, { configurable: true, value: v });
  }
}

// =====================================================================
// Group H — Drag to scroll. Pointer events on the thumb drive Lenis.
// =====================================================================
describe("SmoothScrollArea — drag to scroll", () => {
  beforeEach(() => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": false,
    });
  });

  it("captures the pointer on thumb pointerdown", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const thumb = container.querySelector(
      "[data-scrollbar-thumb]",
    ) as HTMLElement;
    const spy = vi.spyOn(thumb, "setPointerCapture");
    firePointer(thumb, "pointerdown", { clientY: 100, pointerId: 1 });
    expect(spy).toHaveBeenCalledWith(1);
  });

  it("scrolls Lenis by the drag-derived target on pointermove", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const thumb = container.querySelector(
      "[data-scrollbar-thumb]",
    ) as HTMLElement;
    const track = container.querySelector(
      "[data-scrollbar-track]",
    ) as HTMLElement;
    const viewport = container.querySelector(
      ".smooth-scroll-area",
    ) as HTMLElement;
    stubDim(viewport, { scrollHeight: 2000, clientHeight: 500 });
    stubDim(track, { clientHeight: 500 });
    stubDim(thumb, { offsetHeight: 100 });

    firePointer(thumb, "pointerdown", { clientY: 100, pointerId: 1 });
    firePointer(thumb, "pointermove", { clientY: 140, pointerId: 1 });

    const inst = lenisCtor.mock.results[0]?.value as {
      scrollTo: ReturnType<typeof vi.fn>;
    };
    const expected = scrollFromDrag({
      dragRatio: 40 / (500 - 100),
      scrollHeight: 2000,
      clientHeight: 500,
    });
    expect(inst.scrollTo).toHaveBeenCalledWith(expected, { immediate: true });
  });

  it("releases pointer capture and clears drag state on pointerup", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const thumb = container.querySelector(
      "[data-scrollbar-thumb]",
    ) as HTMLElement;
    const releaseSpy = vi.spyOn(thumb, "releasePointerCapture");
    firePointer(thumb, "pointerdown", { clientY: 100, pointerId: 7 });
    firePointer(thumb, "pointerup", { clientY: 100, pointerId: 7 });
    expect(releaseSpy).toHaveBeenCalledWith(7);

    // Drag cleared: subsequent move does NOT scroll.
    const inst = lenisCtor.mock.results[0]?.value as {
      scrollTo: ReturnType<typeof vi.fn>;
    };
    inst.scrollTo.mockClear();
    firePointer(thumb, "pointermove", { clientY: 999, pointerId: 7 });
    expect(inst.scrollTo).not.toHaveBeenCalled();
  });

  // ponytail: I5 — pointercancel (OS gesture / dialog / touch interruption) must
  // tear down the drag the same way pointerup does. Without an onPointerCancel
  // handler, dragRef stays set and the next unrelated pointermove scrolls from
  // stale startY/startThumbTop.
  it("clears drag state on pointercancel so a later pointermove does not scroll (I5)", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const thumb = container.querySelector(
      "[data-scrollbar-thumb]",
    ) as HTMLElement;
    const track = container.querySelector(
      "[data-scrollbar-track]",
    ) as HTMLElement;
    const viewport = container.querySelector(
      ".smooth-scroll-area",
    ) as HTMLElement;
    stubDim(viewport, { scrollHeight: 2000, clientHeight: 500 });
    stubDim(track, { clientHeight: 500 });
    stubDim(thumb, { offsetHeight: 100 });

    const inst = lenisCtor.mock.results[0]?.value as {
      scrollTo: ReturnType<typeof vi.fn>;
    };

    // drag is active — pointermove scrolls
    firePointer(thumb, "pointerdown", { clientY: 100, pointerId: 1 });
    firePointer(thumb, "pointermove", { clientY: 140, pointerId: 1 });
    expect(inst.scrollTo).toHaveBeenCalled();

    // OS cancels the pointer stream mid-drag
    inst.scrollTo.mockClear();
    firePointer(thumb, "pointercancel", { clientY: 140, pointerId: 1 });

    // a later, unrelated pointermove must NOT scroll — drag state was cleared
    firePointer(thumb, "pointermove", { clientY: 200, pointerId: 1 });
    expect(inst.scrollTo).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Group I — Thumb auto-fade. Thumb shows on scroll activity, hides after
// 1000ms idle; hovering the track keeps it visible.
// =====================================================================
describe("SmoothScrollArea — thumb auto-fade", () => {
  beforeEach(() => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides the track on mount (opacity 0)", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const track = container.querySelector(
      "[data-scrollbar-track]",
    ) as HTMLElement;
    expect(track.style.opacity).toBe("0");
  });

  it("shows the track (opacity 1) when Lenis fires a scroll event", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const track = container.querySelector(
      "[data-scrollbar-track]",
    ) as HTMLElement;
    const inst = lenisCtor.mock.results[0]?.value as {
      on: ReturnType<typeof vi.fn>;
    };
    const scrollCb = inst.on.mock.calls.find((c) => c[0] === "scroll")?.[1] as (
      e: { scroll: number },
    ) => void;
    act(() => scrollCb({ scroll: 100 }));
    expect(track.style.opacity).toBe("1");
  });

  it("hides the track again after 1000ms of scroll inactivity", () => {
    vi.useFakeTimers();
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const track = container.querySelector(
      "[data-scrollbar-track]",
    ) as HTMLElement;
    const inst = lenisCtor.mock.results[0]?.value as {
      on: ReturnType<typeof vi.fn>;
    };
    const scrollCb = inst.on.mock.calls.find((c) => c[0] === "scroll")?.[1] as (
      e: { scroll: number },
    ) => void;
    act(() => scrollCb({ scroll: 100 }));
    expect(track.style.opacity).toBe("1");
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(track.style.opacity).toBe("0");
  });

  it("keeps the track visible on pointerenter and resumes fade on pointerleave", () => {
    vi.useFakeTimers();
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const track = container.querySelector(
      "[data-scrollbar-track]",
    ) as HTMLElement;
    // ponytail: React backs onPointerEnter/Leave with pointerover/out at the root.
    firePointer(track, "pointerover");
    expect(track.style.opacity).toBe("1");
    // Idle long enough without leave → still visible (no fade scheduled by enter).
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(track.style.opacity).toBe("1");
    firePointer(track, "pointerout");
    // pointerleave restarts the 1000ms fade timer.
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(track.style.opacity).toBe("0");
  });
});

// =====================================================================
// Group I3 — Thumb position via DOM (perf). height/transform are written
// straight to the thumb element on scroll, NOT via setState — per-frame
// React state would re-render the unmemoized Bookshelf child 60×/sec.
// =====================================================================
describe("SmoothScrollArea — thumb position written to DOM (I3)", () => {
  beforeEach(() => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": false,
    });
  });

  it("writes thumb height and transform to the DOM on scroll", () => {
    const { container } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    const thumb = container.querySelector(
      "[data-scrollbar-thumb]",
    ) as HTMLElement;
    const viewport = container.querySelector(
      ".smooth-scroll-area",
    ) as HTMLElement;
    stubDim(viewport, { scrollHeight: 2000, clientHeight: 500 });

    const inst = lenisCtor.mock.results[0]?.value as {
      on: ReturnType<typeof vi.fn>;
    };
    const scrollCb = inst.on.mock.calls.find((c) => c[0] === "scroll")?.[1] as (
      e: { scroll: number },
    ) => void;
    act(() => scrollCb({ scroll: 500 }));

    // ponytail: height/transform live on the DOM, not React state — per-frame
    // setState would re-render the Bookshelf child 60×/sec. See I3.
    expect(thumb.style.height).toBe("125px");
    expect(thumb.style.transform).toBe("translateY(125px)");
  });
});

// =====================================================================
// Group J — C4 regression: the showThumbTemporarily fade timer is cleared
// on unmount so it can't fire setThumbVisible(false) on a gone component.
// =====================================================================
describe("SmoothScrollArea — C4 regression: clears the pending fade timer on unmount", () => {
  beforeEach(() => {
    stubMatchMedia({
      "(min-width: 1024px)": true,
      "(prefers-reduced-motion: reduce)": false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the pending fade timer on unmount (C4)", () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const { unmount } = render(
      <SmoothScrollArea>
        <div>kids</div>
      </SmoothScrollArea>,
    );
    // drive the lenis scroll callback → showThumbTemporarily schedules a 1000ms
    // fade timer and stores its id on fadeTimerRef.
    const inst = lenisCtor.mock.results[0]?.value as {
      on: ReturnType<typeof vi.fn>;
    };
    const scrollCb = inst.on.mock.calls.find((c) => c[0] === "scroll")?.[1] as (
      e: { scroll: number },
    ) => void;
    act(() => scrollCb({ scroll: 100 }));

    const scheduled = setTimeoutSpy.mock.results.at(-1)?.value;
    expect(scheduled).toBeDefined();

    clearTimeoutSpy.mockClear();
    unmount();
    // the unmount cleanup must clear exactly the pending fade timer
    expect(clearTimeoutSpy).toHaveBeenCalledWith(scheduled);

    // ...and advancing past its delay no longer fires it
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(1001);
      });
    }).not.toThrow();
  });
});
