"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import gsap from "gsap";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

type Direction = "forward" | "back";

interface SceneTransitionApi {
  navigate: (url: string, direction: Direction) => void;
  // True while a forward slide-in is in progress. The reader uses this to
  // defer its heavy <EpubViewer> (iframe) mount until after the animation, so
  // the slide-in paints only the cheap skeleton instead of the whole reader.
  entering: boolean;
}

// ponytail: default context value throws lazily — only when navigate() is
// actually called. Lets BookCard render anywhere (tests, galleries) without
// the provider, while still failing loudly if real navigation runs unmounted.
const NOT_PROVIDED: SceneTransitionApi = {
  navigate: () => {
    throw new Error(
      "useSceneTransition: <SceneTransitionProvider> is missing — navigation unavailable.",
    );
  },
  entering: false,
};

const SceneTransitionContext = createContext<SceneTransitionApi>(NOT_PROVIDED);

export function useSceneTransition(): SceneTransitionApi {
  return useContext(SceneTransitionContext);
}

const LIBRARY_SELECTOR = '[data-scene="library"]';
const READER_SELECTOR = '[data-scene="reader"]';

// Matches .wip-reference/example-bookshelf-to-reader-transition.html:
// library recedes (scale .85, x -8%) and dims while the reader slides in from
// the right, 0.8s power3.inOut, both directions reversible.
//
// ponytail: the dim is NOT `filter: brightness` on the clone. A Safari timeline
// recording showed the forward transition spending 80–110ms/frame in the
// compositor — animating `filter` on the large cloned library forced the
// compositor to re-render every book-cover into the layer texture each frame.
// Instead the clone animates only `transform` (pure GPU), and a separate solid
// dim overlay above it animates `opacity` (one cheap layer). A black overlay at
// opacity 0.45 composites to content*0.55, i.e. visually == brightness(0.55).
const DURATION = 0.8;
const EASE = "power3.inOut";
const RECEDE_TRANSFORM = { scale: 0.85, xPercent: -8 };
const FULL_TRANSFORM = { scale: 1, xPercent: 0 };
const DIM_OPACITY = 0.45;

// ponytail: SSR-safe layout effect so the reader slide-in applies its "from"
// state before first paint (no flash at xPercent:0). Falls back to no-op on
// the server where there is no paint to beat.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// ponytail: clone the library DOM and copy scroll offsets so the receded
// snapshot is pixel-identical to the live page. O(n) over descendants; the
// shelf DOM is small. Ceiling: a huge library (thousands of nodes) would make
// this measurably slow — switch to copying only the scroll container then.
function cloneWithScroll(src: HTMLElement): HTMLElement {
  const clone = src.cloneNode(true) as HTMLElement;
  const srcEls = src.querySelectorAll("*");
  const dstEls = clone.querySelectorAll("*");
  for (let i = 0; i < srcEls.length; i++) {
    const a = srcEls[i] as HTMLElement;
    if (a.scrollTop || a.scrollLeft) {
      const b = dstEls[i] as HTMLElement;
      b.scrollTop = a.scrollTop;
      b.scrollLeft = a.scrollLeft;
    }
  }
  return clone;
}

export function SceneTransitionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = usePrefersReducedMotion();
  const cloneLayerRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);

  // True while the forward reader slide-in is animating. Flips true on arrival
  // and false on slide-in completion (or abort).
  const [entering, setEntering] = useState(false);

  // ponytail: imperative nav state in a ref (not state) so animations don't
  // trigger React re-renders mid-transition. Read by the pathname effect.
  const pendingRef = useRef<{ url: string; direction: Direction } | null>(null);

  const clearLayer = useCallback(() => {
    const layer = cloneLayerRef.current;
    const dim = dimRef.current;
    if (layer) {
      layer.replaceChildren();
      gsap.set(layer, { display: "none" });
    }
    if (dim) gsap.set(dim, { display: "none", opacity: 0 });
  }, []);

  const navigate = useCallback(
    (url: string, direction: Direction) => {
      // Re-entrancy guard — ignore a second nav while one is mid-flight.
      if (pendingRef.current) return;

      if (reducedMotion) {
        router.push(url);
        return;
      }

      const layer = cloneLayerRef.current;
      const dim = dimRef.current;

      if (direction === "forward") {
        const library = document.querySelector(
          LIBRARY_SELECTOR,
        ) as HTMLElement | null;
        if (!library || !layer || !dim) {
          router.push(url);
          return;
        }
        const clone = cloneWithScroll(library);
        // Make the clone opaque with the same field background as <body>
        // (tan + --field-bg tints) so the whole screen — background included —
        // recedes as one unit; the dark stage shows at the scaled edges.
        clone.style.backgroundColor = "var(--background)";
        clone.style.backgroundImage = "var(--field-bg)";
        clone.style.backgroundRepeat = "no-repeat";
        // ponytail: pin the underlay + clone to the real library's exact width.
        // A position:fixed underlay sizes off the ICB, which can land a hair off
        // the static page's layout viewport; at a grid auto-fill breakpoint that
        // hair flips the bookshelf column count (e.g. 4→3) mid-transition.
        const stageWidth = `${library.getBoundingClientRect().width}px`;
        clone.style.width = stageWidth;
        layer.replaceChildren(clone);
        gsap.set(layer, { display: "block", width: stageWidth });
        // will-change pre-promotes so the clone's first paint isn't mid-frame.
        gsap.set(clone, { ...FULL_TRANSFORM, willChange: "transform" });
        gsap.set(dim, {
          display: "block",
          opacity: 0,
          width: stageWidth,
          willChange: "opacity",
        });
        pendingRef.current = { url, direction };
        router.push(url);
        // Library recedes (transform only) + dim overlay fades in, both for
        // instant feedback. The reader slides in when its route commits.
        gsap.to(clone, { ...RECEDE_TRANSFORM, duration: DURATION, ease: EASE });
        gsap.to(dim, { opacity: DIM_OPACITY, duration: DURATION, ease: EASE });
        return;
      }

      // Back: reader slides out to the right while the cloned library
      // un-recedes and un-dims underneath, then we swap to the real route.
      const reader = document.querySelector(
        READER_SELECTOR,
      ) as HTMLElement | null;
      if (!reader || !layer) {
        router.push(url);
        return;
      }
      gsap.set(layer, { display: "block", width: `${document.documentElement.clientWidth}px` });
      if (dim)
        gsap.set(dim, {
          display: "block",
          width: `${document.documentElement.clientWidth}px`,
        }); // opacity left at DIM from forward
      const clone = layer.firstElementChild as HTMLElement | null;
      pendingRef.current = { url, direction };
      const tl = gsap.timeline({ onComplete: () => router.push(url) });
      tl.to(reader, { xPercent: 100, duration: DURATION, ease: EASE }, 0);
      if (clone)
        tl.to(clone, { ...FULL_TRANSFORM, duration: DURATION, ease: EASE }, 0);
      if (dim) tl.to(dim, { opacity: 0, duration: DURATION, ease: EASE }, 0);
    },
    [router, reducedMotion],
  );

  // Arrive: when pathname reaches the pending target, drive the enter half.
  useIsomorphicLayoutEffect(() => {
    const pending = pendingRef.current;
    const onReader = !!pathname && pathname.includes("/reader");

    if (pending) {
      if (pathname === pending.url) {
        if (pending.direction === "forward") {
          const reader = document.querySelector(
            READER_SELECTOR,
          ) as HTMLElement | null;
          pendingRef.current = null;
          if (!reader) {
            setEntering(false);
            clearLayer();
            return;
          }
          // Defer the heavy reader children until the slide-in is done so the
          // animation paints only the cheap skeleton.
          setEntering(true);
          gsap.set(reader, { willChange: "transform" });
          // clearProps:"transform,willChange" so no containing block or layer
          // lingers afterwards — the reader's fixed children (TTS player,
          // floating toolbar) must stay viewport-relative once settled.
          gsap.fromTo(
            reader,
            { xPercent: 100 },
            {
              xPercent: 0,
              duration: DURATION,
              ease: EASE,
              clearProps: "transform,willChange",
              onComplete: () => {
                setEntering(false);
                // Hide the underlay at rest so the receded clone + dim aren't
                // compositing while the reader is open. Restored on back.
                gsap.set(cloneLayerRef.current, { display: "none" });
                gsap.set(dimRef.current, { display: "none" });
              },
            },
          );
        } else {
          // Back arrival at the library — drop the clone; the real library has
          // mounted at full state, matching the clone's animated end state.
          pendingRef.current = null;
          setEntering(false);
          clearLayer();
        }
        return;
      }

      // Didn't reach the pending target — e.g. the reader redirected back to
      // the library (book not found). Abort gracefully so nothing stays stuck.
      if (pending.direction === "forward" && !onReader) {
        pendingRef.current = null;
        setEntering(false);
        clearLayer();
      }
      return;
    }

    // No pending transition: drop any stale clone once we're off the reader
    // route (covers logo clicks, direct URL changes, etc.).
    if (!onReader) {
      const layer = cloneLayerRef.current;
      if (layer && layer.childElementCount > 0) clearLayer();
    }
  }, [pathname, clearLayer]);

  const value = useMemo(
    () => ({ navigate, entering }),
    [navigate, entering],
  );

  return (
    <SceneTransitionContext.Provider value={value}>
      {children}
      {/* ponytail: fixed underlay = the dark "stage". Holds the cloned library
          snapshot (made opaque with the body's field background). pointer-events-
          none so it never blocks; z-0 sits above static page content but below
          the dim overlay (z-[1]) and the reader route (z-10). The clone scales
          over this dark stage, revealing shadow at the edges as it recedes. */}
      <div
        ref={cloneLayerRef}
        data-scene-clone
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#1A130C]"
        style={{ display: "none" }}
      />
      {/* Dim overlay: a single solid black layer whose opacity is animated to
          dim the receding screen. Cheaper to composite than filtering the clone
          subtree every frame. Below the reader (z-10) so it never dims it. */}
      <div
        ref={dimRef}
        data-scene-dim
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[1] bg-black"
        style={{ display: "none", opacity: 0 }}
      />
    </SceneTransitionContext.Provider>
  );
}

// ponytail: self-check — verifies the transition math in isolation, without a
// browser or React tree. Asserts the reference-derived values so a future edit
// that drifts fails loudly.
export function _demoTransitionMath() {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("scene-transition self-check failed: " + msg);
  };
  assert(RECEDE_TRANSFORM.scale === 0.85, "recede scale must be 0.85");
  assert(RECEDE_TRANSFORM.xPercent === -8, "recede xPercent must be -8");
  assert(
    DIM_OPACITY === 0.45,
    "dim opacity must be 0.45 (≈ reference brightness 0.55)",
  );
  assert(
    FULL_TRANSFORM.scale === 1 && FULL_TRANSFORM.xPercent === 0,
    "full state must be identity",
  );
  assert(DURATION === 0.8, "duration must be 0.8s (matches reference)");
  assert(EASE === "power3.inOut", "ease must be power3.inOut (matches reference)");
  return true;
}
