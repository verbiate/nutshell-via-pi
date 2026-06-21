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

// ponytail: a detached clone of the cover frame + the screen rect at capture
// time. Captured at nav (click / back) so the fly has a stable origin even
// after the source DOM unmounts on route swap.
export interface FlyHero {
  node: HTMLElement;
  rect: DOMRect;
}

export interface NavigateOpts {
  // forward: the shelf cover to fly to the sidebar. back: the sidebar cover to
  // fly back to the hero slot.
  hero?: FlyHero;
  // back only: which book is returning (the hero held on the shelf) and
  // whether its sidebar cover was visible (open) at back-nav time.
  bookId?: string;
  sidebarOpen?: boolean;
}

interface ReturningHero {
  bookId: string;
  // true = sidebar was open → fly back to the held-empty hero slot.
  // false = sidebar closed (or reduced motion) → no fly, book just appears.
  fly: boolean;
}

interface SceneTransitionApi {
  navigate: (url: string, direction: Direction, opts?: NavigateOpts) => void;
  // True while a forward slide-in is in progress. The reader uses this to
  // defer its heavy <EpubViewer> (iframe) mount until after the animation.
  entering: boolean;
  // True while a forward cover fly is inbound. The reader holds the real
  // [data-hero-cover] hidden (opacity 0) so the fly clone can land into it,
  // then this flips false at the handoff and the real cover is revealed.
  forwardFlyActive: boolean;
  // Visit-level: suppress the Bookshelf's staggered reveal for this library
  // visit (set on back-nav). Survives Bookshelf remounts within the visit.
  suppressShelfReveal: boolean;
  // Set on back-nav so the freshly-mounted Bookshelf can suppress its ripple
  // reveal and (fly:true) hold the hero slot empty until the cover lands.
  returningHero: ReturningHero | null;
  // Bookshelf calls this once it has measured the hero cover rect (fly:true)
  // or immediately (fly:false). Drives the back fly + clears returningHero.
  settleHero: (rect: DOMRect | null) => void;
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
  forwardFlyActive: false,
  suppressShelfReveal: false,
  returningHero: null,
  settleHero: () => {},
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

// Duration of the cover fly (both directions) + the fade used to hand off
// between the traveling clone and the real cover element underneath.
const FLY_DUR = 0.7;
const HANDOFF_DUR = 0.2;

// ponytail: SSR-safe layout effect so the reader slide-in applies its "from"
// state before first paint (no flash at xPercent:0). Falls back to no-op on
// the server where there is no paint to beat.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// ponytail: native scrollTop/scrollLeft capture/restore for the library clone.
// Lenis drives the SmoothScrollArea viewport via REAL native scroll
// (wrapper.scrollTo, lenis.mjs:524), so scrollTop is the live position — no
// transform to copy. The split (capture → attach → apply) is required: writing
// scrollTop to a DETACHED clone is dropped on attach in WebKit/Safari (Blink
// happens to retain it), which is what made the receding snapshot flash at
// scroll-top instead of the user's scroll position. Applying after the clone is
// in the document sticks in every browser. O(n) over descendants; the shelf DOM
// is small. Ceiling: a huge library (thousands of nodes) would make this
// measurably slow — switch to copying only the scroll container then.
//
// The index-keyed map is aligned to querySelectorAll("*") order, which
// cloneNode(true) preserves, so capture (on src) and apply (on clone) match by
// position without needing element identity.
function captureScrollOffsets(
  src: HTMLElement,
): Map<number, { top: number; left: number }> {
  const offsets = new Map<number, { top: number; left: number }>();
  const els = src.querySelectorAll("*");
  for (let i = 0; i < els.length; i++) {
    const a = els[i] as HTMLElement;
    if (a.scrollTop || a.scrollLeft) {
      offsets.set(i, { top: a.scrollTop, left: a.scrollLeft });
    }
  }
  return offsets;
}

// Apply captured offsets to the clone's matching descendants. Must run AFTER
// the clone is in the document (see captureScrollOffsets).
function applyScrollOffsets(
  clone: HTMLElement,
  offsets: Map<number, { top: number; left: number }>,
) {
  if (offsets.size === 0) return;
  const els = clone.querySelectorAll("*");
  offsets.forEach(({ top, left }, i) => {
    const b = els[i] as HTMLElement | undefined;
    if (!b) return;
    if (top) b.scrollTop = top;
    if (left) b.scrollLeft = left;
  });
}

// Zero every scrolled descendant (back nav: the reused forward clone carries the
// user's old scroll, but the real shelf re-mounts at top, so the clone must
// match top during the slide-out + swap).
function zeroScrollOffsets(clone: HTMLElement) {
  const els = clone.querySelectorAll("*");
  for (let i = 0; i < els.length; i++) {
    const b = els[i] as HTMLElement;
    if (b.scrollTop) b.scrollTop = 0;
    if (b.scrollLeft) b.scrollLeft = 0;
  }
}

// Freeze the cloned search bar's position so it scales with the recede transform
// as part of the library, instead of recomputing its position:fixed (mobile) /
// position:sticky (lg) against the clone's new geometry and scroll state. Without
// this the bar drifts upward independently of the bookshelf mid-transition,
// breaking the illusion that the shelf recedes as one unit. The blur layers
// inside the bar travel with it (they're absolute children), so one freeze
// covers both.
//
// ponytail: reparents the cloned bar to the library-clone root and pins it
// absolutely at its captured viewport-relative offset. The clone becomes the
// containing block via position:relative (transform alone only catches fixed
// descendants, not absolute). Captured ONCE at forward nav; persists through
// the back-direction reuse — inline styles survive cloneNode reuse and the
// scroll-zeroing, since absolute positioning is scroll-independent. Ceiling: a
// vertical resize between forward and back stale the captured top — the bar's
// bottom-pinned role makes the drift imperceptible in practice.
function freezeShelfBar(library: HTMLElement, clone: HTMLElement) {
  const bar = library.querySelector("[data-shelf-bar]") as HTMLElement | null;
  if (!bar) return;
  const clonedBar = clone.querySelector(
    "[data-shelf-bar]",
  ) as HTMLElement | null;
  if (!clonedBar) return;
  const barRect = bar.getBoundingClientRect();
  const libraryRect = library.getBoundingClientRect();
  clone.appendChild(clonedBar);
  clone.style.position = "relative";
  clonedBar.style.position = "absolute";
  // ponytail: pin left + width from the captured rect (not left:0/right:0) so
  // the bar keeps its true horizontal extent. At lg the live bar is position:
  // sticky inside the right column's SmoothScrollArea (lg:grid-cols-[480px_1fr]
  // in home-view.tsx), so its width is the right column's, not the library's.
  // Spanning left:0/right:0 here made the inner pill (max-w-[520px] +
  // justify-center) re-center to full library width — shifting it off the books.
  clonedBar.style.left = `${barRect.left - libraryRect.left}px`;
  clonedBar.style.width = `${barRect.width}px`;
  clonedBar.style.right = "auto";
  clonedBar.style.bottom = "auto";
  clonedBar.style.top = `${barRect.top - libraryRect.top}px`;
  clonedBar.style.height = `${barRect.height}px`;
  clonedBar.style.margin = "0px";
  // Hide the SmoothScrollArea custom scrollbar thumb in the clone — its inline
  // opacity (captured from thumbVisible state in smooth-scroll-area.tsx:201)
  // may be 1 if the user scrolled recently, leaving a dark vertical bar
  // floating over the receding shelf.
  const track = clone.querySelector(
    "[data-scrollbar-track]",
  ) as HTMLElement | null;
  if (track) track.style.opacity = "0";
}

// Approximate resting rect of the sidebar cover (top-RIGHT — the sidebar lives
// at `right: var(--reader-rail-w)`). Computed from the reader geometry vars so
// the forward fly lands where the real cover will mount. dismissFly() fades the
// clone out over the real element, so a few px of error here are imperceptible.
// ponytail: the Contents tab renders NO generic sidebar header above the panel,
// so HEADER_H is 0 (the cover's top = the details card's pt-12 = PAD_Y = 48).
// The details card uses px-12 (PAD_X = 48), and the cover is self-start
// top-pinned (see reader-panel.tsx) so its top is deterministic regardless of
// title length. coverW reads --reader-cover-w; coverH is derived at 3/4 aspect
// to match BookCover's placeholder ratio. Real covers may differ slightly — the
// handoff crossfade hides the discrepancy.
function computeReaderCoverRect(): DOMRect {
  const cs = getComputedStyle(document.documentElement);
  const num = (v: string, d: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : d;
  };
  const sidebarW = num(cs.getPropertyValue("--reader-sidebar-w"), 400);
  const railW = num(cs.getPropertyValue("--reader-rail-w"), 94);
  const vw = window.innerWidth;
  const HEADER_H = 0;
  const PAD_Y = 48;
  const PAD_X = 48;
  const coverW = num(cs.getPropertyValue("--reader-cover-w"), 108);
  const coverH = Math.round((coverW * 4) / 3);
  const left = vw - railW - sidebarW + PAD_X;
  const top = HEADER_H + PAD_Y;
  return {
    left,
    top,
    width: coverW,
    height: coverH,
    right: left + coverW,
    bottom: top + coverH,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

// Position a clone at `rect` (fixed, transform-origin top-left) ready to tween.
function prepClone(clone: HTMLElement, rect: DOMRect) {
  clone.removeAttribute("id");
  clone.setAttribute("aria-hidden", "true");
  clone.style.pointerEvents = "none";
  clone.style.margin = "0";
  gsap.set(clone, {
    position: "fixed",
    left: 0,
    top: 0,
    width: rect.width,
    height: rect.height,
    x: rect.left,
    y: rect.top,
    transformOrigin: "0px 0px",
    willChange: "transform",
    zIndex: 80,
  });
}

// Fly a clone from `from` to `to`, resizing via uniform scale (cover aspect is
// ~3/4 at both ends; minor aspect drift resolves under the handoff fade).
function flyClone(
  clone: HTMLElement,
  from: DOMRect,
  to: DOMRect,
  duration: number,
  ease: string,
  onComplete?: () => void,
) {
  prepClone(clone, from);
  const s = to.width / (from.width || to.width || 1);
  gsap.to(clone, {
    x: to.left,
    y: to.top,
    scale: s,
    duration,
    ease,
    onComplete,
  });
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
  const flyLayerRef = useRef<HTMLDivElement>(null);

  // True while the forward reader slide-in is animating. Flips true on arrival
  // and false on slide-in completion (or abort).
  const [entering, setEntering] = useState(false);
  // True while a forward cover fly is inbound (set at forward nav when a hero
  // was captured; cleared at the landing handoff). The reader holds the real
  // sidebar cover hidden while this is true.
  const [forwardFlyActive, setForwardFlyActive] = useState(false);
  // Set on back-nav; consumed by the Bookshelf on its mount.
  const [returningHero, setReturningHero] = useState<ReturningHero | null>(
    null,
  );
  // ponytail: visit-level ripple suppression. Unlike returningHero (which clears
  // at the fly handoff), this stays true for the entire library visit so a
  // Bookshelf remount (e.g. home-view's router.refresh re-fetching the RSC
  // after returningHero has cleared) still suppresses the staggered reveal.
  // Set on back-nav, cleared on forward-nav or a non-back library arrival.
  const [suppressShelfReveal, setSuppressShelfReveal] = useState(false);

  // ponytail: imperative nav state in refs (not state) so animations don't
  // trigger React re-renders mid-transition. Read by the pathname effect.
  const pendingRef = useRef<{ url: string; direction: Direction } | null>(null);
  // Fly state for the in-flight transition (separate from pendingRef so the
  // arrival effect can read it before clearing pendingRef).
  const pendingFlyRef = useRef<{
    hero?: FlyHero; // forward
    bookId?: string; // back
    fly?: boolean; // back
  } | null>(null);
  // ponytail: two separate clone refs so a lingering FORWARD clone (reader
  // errored or user backed out before the sidebar opened) can be retired without
  // touching an in-flight BACK clone. forwardFlyRef parks at the reader cover
  // rect until dismissFly(); backFlyRef parks at the sidebar rect until
  // settleHero().
  const forwardFlyRef = useRef<HTMLElement | null>(null);
  const backFlyRef = useRef<HTMLElement | null>(null);
  // True once the back part-1 fly (sidebar → first slot, concurrent with the
  // slide-out) has been added to the timeline. settleHero uses this to decide
  // between a quick handoff (part-1 flew) and a full fly (fallback).
  const backFlyPart1Ref = useRef(false);

  // ponytail: stash <html>.style.overflow across the transition so it can be
  // restored exactly (empty string = default). Locked at navigate(), restored
  // at every completion/abort path + unmount.
  const prevHtmlOverflowRef = useRef<string>("");

  // Fade a parked clone out + remove it, clearing the owning ref if it still
  // points at the same node (a later fly may have reassigned it).
  const retireClone = useCallback(
    (ref: React.MutableRefObject<HTMLElement | null>) => {
      const node = ref.current;
      if (!node) return;
      gsap.killTweensOf(node);
      gsap.to(node, {
        opacity: 0,
        duration: HANDOFF_DUR,
        ease: EASE,
        onComplete: () => {
          node.remove();
          if (ref.current === node) ref.current = null;
        },
      });
    },
    [],
  );

  const clearLayer = useCallback(() => {
    const layer = cloneLayerRef.current;
    const dim = dimRef.current;
    if (layer) {
      layer.replaceChildren();
      gsap.set(layer, { display: "none" });
    }
    if (dim) gsap.set(dim, { display: "none", opacity: 0 });
  }, []);

  // Immediately drop both fly clones + pending state (abort, unmount).
  const clearFly = useCallback(() => {
    for (const ref of [forwardFlyRef, backFlyRef]) {
      const node = ref.current;
      if (node) {
        gsap.killTweensOf(node);
        node.remove();
        ref.current = null;
      }
    }
    pendingFlyRef.current = null;
    backFlyPart1Ref.current = false;
    setForwardFlyActive(false);
  }, []);

  // ponytail: lock <html> scroll during the transition. The route swap briefly
  // mounts both routes; at mobile the library has no overflow:hidden (its
  // bookshelf grows the body), and the reader's w-screen (100vw) then trips a
  // horizontal scrollbar as 100vw > visible width once the body has a vertical
  // one. Locking <html> suppresses both. Ceiling: doesn't fix the underlying
  // w-screen issue on the reader — only the transition symptom. Unlocked at
  // every completion/abort path (6 sites) + unmount.
  const lockScroll = useCallback(() => {
    prevHtmlOverflowRef.current = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }, []);

  const unlockScroll = useCallback(() => {
    document.documentElement.style.overflow = prevHtmlOverflowRef.current;
  }, []);

  const navigate = useCallback(
    (url: string, direction: Direction, opts?: NavigateOpts) => {
      // Re-entrancy guard — ignore a second nav while one is mid-flight.
      if (pendingRef.current) return;

      // Forward nav: any stale returningHero (e.g. user backed then immediately
      // opened another book) is now irrelevant.
      if (direction === "forward" && returningHero) setReturningHero(null);
      // Leaving the library → this library visit's suppression ends.
      if (direction === "forward") setSuppressShelfReveal(false);

      if (reducedMotion) {
        // No fly, no slide. Back still suppresses the shelf ripple this visit.
        if (direction === "back" && opts?.bookId) {
          setReturningHero({ bookId: opts.bookId, fly: false });
        }
        router.push(url);
        return;
      }

      const layer = cloneLayerRef.current;
      const dim = dimRef.current;
      const flyLayer = flyLayerRef.current;

      if (direction === "forward") {
        const library = document.querySelector(
          LIBRARY_SELECTOR,
        ) as HTMLElement | null;
        if (!library || !layer || !dim) {
          router.push(url);
          return;
        }
        // Lock body scroll now — the route swap happens once router.push fires
        // below, and we need overflow:hidden in place before then.
        lockScroll();
        // Capture scroll BEFORE cloning (non-mutating read of live scrollTop).
        const scrollOffsets = captureScrollOffsets(library);
        const clone = library.cloneNode(true) as HTMLElement;
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
        // ponytail: vacate the departing book's slot in the receding clone so the
        // book "leaves" the shelf (visibility:hidden retains the grid cell). The
        // real shelf unmounts; this clone is what's seen receding during the
        // slide-in, and it should show an empty slot where the book was.
        if (opts?.bookId) {
          const departing = clone.querySelector(
            `[data-book-card][data-book-id="${CSS.escape(opts.bookId)}"]`,
          ) as HTMLElement | null;
          if (departing) departing.style.visibility = "hidden";
        }
        layer.replaceChildren(clone);
        // Make the layer visible BEFORE applying scroll offsets: scrollTop set
        // on a display:none subtree is ignored/reset by browsers, so the recede
        // would still show scroll-top. All of this is one synchronous task, so
        // there's no paint between display:block and the scrollTop write.
        gsap.set(layer, { display: "block", width: stageWidth });
        applyScrollOffsets(clone, scrollOffsets);
        // Freeze the search bar's position in the clone BEFORE the transform
        // runs — otherwise its position:fixed/sticky recomputes against the
        // clone's new geometry and drifts up independently of the bookshelf.
        // Captured here (live library still mounted); persists through the
        // back-direction clone reuse.
        freezeShelfBar(library, clone);
        // will-change pre-promotes so the clone's first paint isn't mid-frame.
        gsap.set(clone, { ...FULL_TRANSFORM, willChange: "transform" });
        gsap.set(dim, {
          display: "block",
          opacity: 0,
          width: stageWidth,
          willChange: "opacity",
        });
        pendingRef.current = { url, direction };
        pendingFlyRef.current = opts?.hero ? { hero: opts.hero } : null;
        // A forward cover fly is now inbound — the reader holds its real
        // sidebar cover hidden (forwardFlyActive) until the fly lands.
        if (opts?.hero) setForwardFlyActive(true);
        router.push(url);
        // Library recedes (transform only) + dim overlay fades in, both for
        // instant feedback. The reader slides in when its route commits.
        gsap.to(clone, { ...RECEDE_TRANSFORM, duration: DURATION, ease: EASE });
        gsap.to(dim, { opacity: DIM_OPACITY, duration: DURATION, ease: EASE });
        return;
      }

      // ── Back ───────────────────────────────────────────────────────────
      // Retire any lingering FORWARD fly clone (reader errored, or user backed
      // out before the sidebar ever opened → the landing handoff never fired).
      // A separate ref from the back clone we're about to park, so this can't
      // kill the in-flight back fly. Also release the held-hidden real cover.
      retireClone(forwardFlyRef);
      setForwardFlyActive(false);

      const fly = !!opts?.sidebarOpen && !!opts?.hero;
      // returningHero is set NOW (not on arrival) so the Bookshelf — whose
      // child-depth layout effect beats this provider's pathname effect — sees
      // it on its very first render and can suppress the ripple reveal.
      if (opts?.bookId) setReturningHero({ bookId: opts.bookId, fly });
      // Visit-level: suppress the shelf ripple for this whole library visit.
      setSuppressShelfReveal(true);
      pendingFlyRef.current = opts?.bookId
        ? { bookId: opts.bookId, fly }
        : null;

      // Park the cover clone at its captured rect so it stays put while the
      // reader slides out from under it (the book is "plucked" off the departing
      // reader). Part-1 of the fly (below) sends it to the first shelf slot
      // concurrently with the slide-out, so the book flies during the transition
      // rather than hovering until the shelf mounts.
      if (fly && opts?.hero && flyLayer) {
        const node = opts.hero.node;
        flyLayer.appendChild(node);
        prepClone(node, opts.hero.rect);
        backFlyRef.current = node;
      }

      const reader = document.querySelector(
        READER_SELECTOR,
      ) as HTMLElement | null;
      if (!reader || !layer) {
        router.push(url);
        return;
      }
      // Lock body scroll for the back transition window.
      lockScroll();
      gsap.set(layer, {
        display: "block",
        width: `${document.documentElement.clientWidth}px`,
      });
      if (dim)
        gsap.set(dim, {
          display: "block",
          width: `${document.documentElement.clientWidth}px`,
        }); // opacity left at DIM from forward
      const clone = layer.firstElementChild as HTMLElement | null;
      // ponytail: a resize during the reader session stale the forward clone's
      // pinned width (captured at forward nav to the old viewport — line 355).
      // Reflow it to the current viewport so the grid (auto-fill,
      // minmax(150px,1fr)) re-computes its column count and matches the real
      // shelf that mounts at swap — otherwise stale columns show during the
      // slide-out and jump at the route swap. The getBoundingClientRect() read
      // below (slot-0 measure) forces the reflow before the first frame.
      // Residual: uses clientWidth (live library element is unmounted on back);
      // a scrollbar-width gap could flip one column at an exact breakpoint.
      if (clone)
        clone.style.width = `${document.documentElement.clientWidth}px`;
      // ponytail: the reused forward clone still carries the user's pre-read
      // scroll, but the real shelf re-mounts at top on back (fresh Lenis), so
      // zero the clone now — hidden under the reader (z-10) at this moment, so
      // the reset is invisible; the slide-out then reveals a top-positioned
      // clone that matches the real shelf at swap. Runs before the slot-0
      // measure so the part-1 fly targets the top slot.
      if (clone) zeroScrollOffsets(clone);

      // ponytail: make slot 0 of the cloned shelf read as VACANT so the
      // returning book has a clear spot to land during the slide-out. The clone
      // is the pre-read snapshot (old order); the real shelf (mounted at swap)
      // will have the just-read book at slot 0 by recency, held empty until the
      // fly lands. Reorder the clone the same way — move the hero card to slot 0
      // — then hide it (visibility:hidden retains the cell for layout). The
      // clone's other books keep their relative order, so the real shelf matches
      // at swap with no shuffle.
      if (clone && opts?.bookId) {
        const heroCard = clone.querySelector(
          `[data-book-card][data-book-id="${CSS.escape(opts.bookId)}"]`,
        ) as HTMLElement | null;
        if (heroCard) {
          const parent = heroCard.parentElement;
          if (parent && parent.firstChild !== heroCard) {
            parent.insertBefore(heroCard, parent.firstChild);
          }
          // ponytail: only vacate slot 0 when a fly is inbound (fly:true). With
          // fly:false (sidebar was closed / reduced motion) no clone travels to
          // fill the slot, so the book must stay visible here — otherwise slot 0
          // reads blank during the slide-out and pops in at swap. The reorder
          // above still runs so the clone matches the real shelf's recency order.
          // Also reset the forward-clone's `visibility:hidden` on the departing
          // book (scene-transition.tsx:364) so fly:false doesn't inherit a blank.
          heroCard.style.visibility = fly ? "hidden" : "";
        }
      }

      // ponytail: snap-measure the first shelf slot's FINAL (un-receded)
      // position from the library clone, so the part-1 fly can target slot 0
      // during the slide-out (before the real shelf mounts). All synchronous and
      // before paint: snap clone to identity, read the (now-hidden) hero cover
      // rect, snap back to receded — the user never sees the identity state. The
      // first SLOT's geometry is identical to the real shelf's (the clone is a
      // faithful snapshot), so this is where the just-read book (#1 by recency)
      // lives.
      let firstSlotRect: DOMRect | null = null;
      if (clone) {
        gsap.set(clone, { ...FULL_TRANSFORM });
        const slot = clone.querySelector(
          "[data-book-card] [data-book-cover]",
        ) as HTMLElement | null;
        firstSlotRect = slot ? slot.getBoundingClientRect() : null;
        gsap.set(clone, { ...RECEDE_TRANSFORM });
      }

      pendingRef.current = { url, direction };
      backFlyPart1Ref.current = false;
      const tl = gsap.timeline({ onComplete: () => router.push(url) });
      tl.to(reader, { xPercent: 100, duration: DURATION, ease: EASE }, 0);
      if (clone)
        tl.to(clone, { ...FULL_TRANSFORM, duration: DURATION, ease: EASE }, 0);
      if (dim) tl.to(dim, { opacity: 0, duration: DURATION, ease: EASE }, 0);
      // Part-1 fly: sidebar rect → first slot, concurrent with the slide-out +
      // un-recede. Lands at slot 0 as the shelf settles. (settleHero, called
      // once the real Bookshelf mounts, does the final snap + crossfade handoff.)
      if (fly && backFlyRef.current && firstSlotRect && opts?.hero) {
        const node = backFlyRef.current;
        const fromW = opts.hero.rect.width || firstSlotRect.width || 1;
        tl.to(
          node,
          {
            x: firstSlotRect.left,
            y: firstSlotRect.top,
            scale: firstSlotRect.width / fromW,
            duration: DURATION,
            ease: EASE,
          },
          0,
        );
        backFlyPart1Ref.current = true;
      }
    },
    [router, reducedMotion, returningHero, lockScroll],
  );

  // Bookshelf → provider: the hero slot is ready (real shelf mounted, hero held
  // empty). If part-1 already flew the clone to slot 0 during the slide-out, do
  // just the snap + crossfade handoff; otherwise (no library clone was available
  // to measure, e.g. direct-URL reader) fly from the parked origin now. Either
  // way returningHero clears (revealing the held hero).
  const settleHero = useCallback((rect: DOMRect | null) => {
    const parked = backFlyRef.current;
    if (rect && parked && flyLayerRef.current) {
      if (backFlyPart1Ref.current) {
        // Settle + dissolve: nudge the clone onto the real hero rect AS it
        // fades out, revealing the (instantly opaque) real book beneath. The
        // clone is already sized correctly (part-1 scaled it to the shelf slot),
        // so we animate ONLY position + opacity — a scale tween here would
        // shrink the clone to its natural sidebar size as it fades. A single
        // tween (no instant snap) avoids the one-frame jump that read as a pop.
        gsap.to(parked, {
          x: rect.left,
          y: rect.top,
          opacity: 0,
          duration: HANDOFF_DUR,
          ease: EASE,
          onComplete: () => {
            parked.remove();
            if (backFlyRef.current === parked) backFlyRef.current = null;
            backFlyPart1Ref.current = false;
          },
        });
        setReturningHero(null);
        return;
      }
      // Fallback (no part-1): fly from the parked origin to the hero rect now.
      const from = parked.getBoundingClientRect();
      flyClone(parked, from, rect, FLY_DUR, EASE, () => {
        gsap.to(parked, {
          opacity: 0,
          duration: HANDOFF_DUR,
          ease: EASE,
          onComplete: () => {
            parked.remove();
            if (backFlyRef.current === parked) backFlyRef.current = null;
          },
        });
        setReturningHero(null);
      });
      return;
    }
    // fly:false (closed sidebar / reduced motion) or no parked clone: just
    // release the hero.
    if (parked) {
      parked.remove();
      backFlyRef.current = null;
    }
    backFlyPart1Ref.current = false;
    setReturningHero(null);
  }, []);

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
          const hero = pendingFlyRef.current?.hero;
          pendingRef.current = null;
          if (!reader) {
            setEntering(false);
            clearLayer();
            clearFly();
            unlockScroll();
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
                // Body scroll restored — the reader has settled.
                unlockScroll();
              },
            },
          );
          // Forward cover fly — concurrent with the slide-in. Lands at the
          // reader cover rect as the slide-in + sidebar-open complete, then
          // hands off to the real [data-hero-cover] (held hidden via
          // forwardFlyActive): snap to its actual rect, crossfade the clone out
          // as the reader reveals the real cover.
          if (hero && flyLayerRef.current) {
            const node = hero.node;
            flyLayerRef.current.appendChild(node);
            const target = computeReaderCoverRect();
            flyClone(node, hero.rect, target, DURATION, EASE, () => {
              const real = document.querySelector(
                "[data-hero-cover]",
              ) as HTMLElement | null;
              const r = real?.getBoundingClientRect();
              // Settle + dissolve: glide onto the real cover rect AS it fades
              // out, revealing the (instantly opaque) real cover beneath. One
              // tween, no instant snap → no pop.
              gsap.to(node, {
                ...(r
                  ? {
                      x: r.left,
                      y: r.top,
                      scale: r.width / (hero.rect.width || r.width || 1),
                    }
                  : {}),
                opacity: 0,
                duration: HANDOFF_DUR,
                ease: EASE,
                onComplete: () => {
                  node.remove();
                  if (forwardFlyRef.current === node) forwardFlyRef.current = null;
                },
              });
              // Reveal the real sidebar cover underneath the fading clone.
              setForwardFlyActive(false);
            });
            forwardFlyRef.current = node;
          }
          pendingFlyRef.current = null;
        } else {
          // Back arrival at the library — drop the underlay; the real library
          // has mounted at full state, matching the clone's animated end state.
          // The fly clone (if any) stays parked in the fly layer for the
          // Bookshelf to trigger via settleHero().
          pendingRef.current = null;
          setEntering(false);
          clearLayer();
          unlockScroll();
        }
        return;
      }

      // Didn't reach the pending target — e.g. the reader redirected back to
      // the library (book not found). Abort gracefully so nothing stays stuck.
      if (pending.direction === "forward" && !onReader) {
        pendingRef.current = null;
        setEntering(false);
        clearLayer();
        clearFly();
        setReturningHero(null);
        unlockScroll();
      }
      return;
    }

    // No pending transition: drop any stale clone once we're off the reader
    // route (covers logo clicks, direct URL changes, etc.). Also drop a lingering
    // forward fly clone (e.g. reader errored before the sidebar opened). A
    // non-back arrival at the library is a fresh visit — clear visit suppression.
    if (!onReader) {
      const layer = cloneLayerRef.current;
      if (layer && layer.childElementCount > 0) clearLayer();
      if (forwardFlyRef.current || backFlyRef.current) clearFly();
      setSuppressShelfReveal(false);
      // Defensive: a previous transition may have locked scroll and crashed
      // before unlocking. Idempotent restore here keeps the page scrollable.
      unlockScroll();
    }
  }, [pathname, clearLayer, clearFly, unlockScroll]);

  // Clean up fly state + restore body scroll on unmount.
  useEffect(() => {
    return () => {
      clearFly();
      unlockScroll();
    };
  }, [clearFly, unlockScroll]);

  const value = useMemo(
    () => ({
      navigate,
      entering,
      forwardFlyActive,
      suppressShelfReveal,
      returningHero,
      settleHero,
    }),
    [navigate, entering, forwardFlyActive, suppressShelfReveal, returningHero, settleHero],
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
      {/* Fly layer: hosts the traveling cover clone (forward + back). Above the
          reader (z-10), dim (z-[1]), and the reader skeleton (z-60) so the
          clone paints on top throughout. Empty + pointer-events-none = inert. */}
      <div
        ref={flyLayerRef}
        data-scene-fly
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[80]"
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
  assert(FLY_DUR === 0.7, "fly duration must be 0.7s");
  assert(HANDOFF_DUR === 0.2, "handoff fade must be 0.2s");
  return true;
}

// ponytail: self-check for freezeShelfBar — verifies the freeze pins the cloned
// bar absolutely at the captured offset and reparents it to the clone root.
// Mocks getBoundingClientRect on the live elements (the freeze only reads rects
// from the live library + bar, not from the clone, so cloneNode's failure to
// carry instance-method overrides across doesn't matter).
export function _demoFreezeShelfBar() {
  // Realistic lg rect set: library fills the viewport, bar sits in the right
  // column (lg:grid-cols-[480px_1fr] → right column starts at x=504 in a 1280px
  // viewport with a 24px gap), full column width = 776px.
  const mockRect = (
    top: number,
    left: number,
    width: number,
    height: number
  ): DOMRect =>
    ({
      top,
      bottom: top + height,
      height,
      left,
      right: left + width,
      width,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  const library = document.createElement("div");
  const bar = document.createElement("div");
  bar.setAttribute("data-shelf-bar", "");
  library.appendChild(bar);
  library.getBoundingClientRect = () => mockRect(0, 0, 1280, 800);
  bar.getBoundingClientRect = () => mockRect(662, 504, 776, 138);

  const clone = library.cloneNode(true) as HTMLElement;
  freezeShelfBar(library, clone);

  const clonedBar = clone.querySelector("[data-shelf-bar]") as HTMLElement;
  const assert = (cond: boolean, msg: string) => {
    if (!cond)
      throw new Error("scene-transition freeze self-check failed: " + msg);
  };
  assert(
    clonedBar.style.position === "absolute",
    "cloned bar must be position:absolute",
  );
  assert(clonedBar.style.top === "662px", "top must be 662px (662 - 0)");
  assert(
    clonedBar.style.left === "504px",
    "left must be 504px (captured from right column, not 0)",
  );
  assert(
    clonedBar.style.width === "776px",
    "width must be 776px (captured, not full library width)",
  );
  assert(clonedBar.style.height === "138px", "height must be 138px");
  assert(
    clonedBar.style.right === "auto",
    "right must be auto (left+width pin, not left+right stretch)",
  );
  assert(clonedBar.style.bottom === "auto", "bottom must be auto (override)");
  assert(
    clone.style.position === "relative",
    "clone must be position:relative (containing block for the absolute bar)",
  );
  assert(
    clonedBar.parentElement === clone,
    "cloned bar must be reparented to the clone root",
  );
  return true;
}
