"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Compass, Search } from "lucide-react";
import { DailyDigest } from "./daily-digest";
import { Bookshelf } from "./bookshelf";
import { SmoothScrollArea } from "./smooth-scroll-area";
import { DiscussionsHomeView } from "./discussions-home";
import { useSceneTransition } from "@/components/transitions/scene-transition";
import type { LibraryBook } from "@/types/book";
import type { DiscussionListItem } from "@/types/discussion";

// ponytail: progressive blur = stacked masked backdrop-filter layers (geometric
// blur staircase) + a tint gradient on top. Tunable via NUM/MAX/EXP/SOLID_STOP.
const BLUR_LAYERS = (() => {
  const numLayers = 4;
  const maxBlur = 10;
  const exponent = 2;
  const bandWidth = 100 / (numLayers + 1);
  const layers: { blur: number; mask: string }[] = [];
  for (let i = 0; i < numLayers; i++) {
    const normalized = exponent ** i / exponent ** (numLayers - 1);
    const blur = maxBlur * normalized;
    const fadeIn = i * bandWidth;
    const peakIn = (i + 1) * bandWidth;
    const peakOut = Math.min((i + 2) * bandWidth, 100);
    const fadeOut = (i + 3) * bandWidth;
    const isLast = fadeOut >= 100;
    const mask = isLast
      ? `linear-gradient(to bottom, rgba(0,0,0,0) ${fadeIn}%, rgba(0,0,0,1) ${peakIn}%, rgba(0,0,0,1) 100%)`
      : `linear-gradient(to bottom, rgba(0,0,0,0) ${fadeIn}%, rgba(0,0,0,1) ${peakIn}%, rgba(0,0,0,1) ${peakOut}%, rgba(0,0,0,0) ${fadeOut}%)`;
    layers.push({ blur, mask });
  }
  return layers;
})();

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

interface HomeViewProps {
  userName: string | null;
  books: LibraryBook[];
  digestImage: string | null;
  // ponytail: pre-fetched by the server component so the Discussions tab
  // renders SSR without a client fetch waterfall. The client component
  // refetches on mount for freshness.
  discussions?: DiscussionListItem[];
  // ponytail: when true, this HomeView is rendered as a non-interactive
  // snapshot (e.g. inside BookshelfSnapshot for the refresh-back-nav case).
  // Skips router.refresh() and disables interactive elements. The real
  // Bookshelf on /my-library always has static=false.
  static?: boolean;
}

export function HomeView({
  userName,
  books,
  digestImage,
  discussions,
  static: isStatic = false,
}: HomeViewProps) {
  // ponytail: greeting computed on mount to respect the viewer's local timezone
  const [greeting, setGreeting] = useState("Hello");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGreeting(timeGreeting());
  }, []);

  const router = useRouter();
  const { suppressShelfReveal } = useSceneTransition();

  // ponytail: keep the daily-digest image stable across a reader → library
  // return. The image is re-picked at random server-side on every page load, so
  // without this a back-return would flash a new photo. The live HomeView reads
  // sessionStorage in the useState initializer ONLY on a soft-nav back-return
  // (suppressShelfReveal:true — safe because soft nav doesn't re-hydrate); on a
  // fresh page load it uses the server prop and matches SSR.
  //
  // Static (snapshot) mode can't read sessionStorage in the initializer without
  // breaking hydration (the snapshot is server-rendered as part of the reader
  // RSC). It uses the prop initially, then a post-hydration useEffect below
  // syncs the cached value so the snapshot matches the live shelf at swap.
  // The snapshot never writes to storage — the live shelf is the source of
  // truth, and a write here would clobber the cached value before the sync
  // effect can read it.
  const [digestSrc, setDigestSrc] = useState<string | null>(() => {
    if (!isStatic && suppressShelfReveal && typeof window !== "undefined") {
      const cached = window.sessionStorage.getItem("nutshell.digest");
      if (cached) return cached;
    }
    return digestImage;
  });
  useEffect(() => {
    if (isStatic) return;
    if (typeof window !== "undefined" && digestSrc) {
      window.sessionStorage.setItem("nutshell.digest", digestSrc);
    }
  }, [digestSrc, isStatic]);
  // Static only: swap in the cached digest after hydration so the snapshot
  // matches what the live shelf will show at swap. Runs post-hydration to
  // avoid SSR mismatch. Idempotent — re-runs after the set-state but finds
  // cached === digestSrc and no-ops.
  useEffect(() => {
    if (!isStatic || typeof window === "undefined") return;
    const cached = window.sessionStorage.getItem("nutshell.digest");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached && cached !== digestSrc) setDigestSrc(cached);
  }, [isStatic, digestSrc]);

  useEffect(() => {
    // Refresh on mount so returning from the reader (or any soft nav) shows the
    // latest recency/progress instead of the client Router Cache's stale RSC.
    // Snapshots skip this — they're rendered off-screen and replaced at swap.
    if (isStatic) return;
    router.refresh();
  }, [router, isStatic]);

  const first = userName?.split(" ")[0] || "reader";

  // ponytail: controlled tab value so the Discussions empty-state CTA can
  // route the user to Bookshelf. Uncontrolled (defaultValue) elsewhere.
  const [tabValue, setTabValue] = useState("bookshelf");

  return (
    <Tabs
      value={tabValue}
      onValueChange={setTabValue}
      defaultValue="bookshelf"
      className="flex w-full flex-col lg:min-h-0 lg:flex-1"
    >
      <div className="grid shrink-0 gap-4 lg:grid-cols-[480px_1fr] lg:items-end lg:gap-6">
        <div>
          <h1 className="type-header">
            {greeting}, {first}
          </h1>
          <p className="text-base text-muted-foreground">
            What will we learn today?
          </p>
        </div>
        <div className="px-12">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="bookshelf">Bookshelf</TabsTrigger>
            <TabsTrigger value="explainers">Discussions</TabsTrigger>
            <TabsTrigger value="find">Find more books</TabsTrigger>
          </TabsList>
        </div>
      </div>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[480px_1fr] lg:grid-rows-1 lg:min-h-0 lg:flex-1">
        <DailyDigest imageSrc={digestSrc} />
        <div className="lg:relative lg:min-h-0 lg:self-stretch lg:overflow-hidden">
          <TabsContent value="bookshelf" className="lg:absolute lg:inset-0">
            <SmoothScrollArea className="lg:absolute lg:inset-0">
              <div className="pb-3">
                <Bookshelf books={books} static={isStatic} />
              </div>
              {/* ponytail: sticky to the bookshelf scroll box at lg; ceiling — on a near-empty shelf the bar sits at end of flow rather than pinned. Upgrade: lift as sibling overlay + controlled Tabs. */}
              {/* data-shelf-bar: hook for SceneTransitionProvider to freeze this
                  element's position in the receding clone — see freezeShelfBar
                  in scene-transition.tsx. Without it the bar's fixed/sticky
                  positioning recomputes against the clone's transform and drifts
                  up independently of the bookshelf. */}
              <div data-shelf-bar className="fixed inset-x-0 bottom-0 h-[138px] lg:sticky lg:bottom-0">
                <div className="absolute inset-0">
                  {BLUR_LAYERS.map((layer, i) => (
                    <div
                      key={i}
                      className="absolute inset-0"
                      style={{
                        backdropFilter: `blur(${layer.blur}px)`,
                        WebkitBackdropFilter: `blur(${layer.blur}px)`,
                        maskImage: layer.mask,
                        WebkitMaskImage: layer.mask,
                      }}
                    />
                  ))}
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(to top, color-mix(in srgb, var(--paper) 60%, transparent) 0%, color-mix(in srgb, var(--paper) 54%, transparent) 25%, transparent 100%)",
                    }}
                  />
                </div>
                <div className="relative flex h-full items-center justify-center px-8">
                  <div className="flex w-full max-w-[520px] items-center gap-3 rounded-full border border-line bg-white px-5 py-3.5 shadow-float">
                    <Search className="size-4 shrink-0 text-muted-foreground" />
                    <input
                      type="search"
                      aria-label="Search books"
                      placeholder="Search or ask your books…"
                      className="flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted-foreground/70"
                    />
                  </div>
                </div>
              </div>
            </SmoothScrollArea>
          </TabsContent>
          <TabsContent value="explainers" className="lg:absolute lg:inset-0">
            {/*
              ponytail: NO SmoothScrollArea wrapper here — DiscussionsHomeView
              wraps its LIST in SmoothScrollArea internally but renders the
              DETAIL view without it. The detail view is chat-shaped (header
              pinned top, composer pinned bottom, messages scroll between),
              and an outer ScrollArea breaks that flex layout — heights don't
              propagate and the composer scrolls away with content. Mirrors
              the reader-sidebar bulb pattern (reader-sidebar.tsx:116-126).
            */}
            <DiscussionsHomeView
              discussions={discussions ?? []}
              onGoToBookshelf={() => setTabValue("bookshelf")}
              books={books}
            />
          </TabsContent>
          <TabsContent value="find" className="lg:absolute lg:inset-0">
            <SmoothScrollArea className="lg:absolute lg:inset-0">
              <div className="flex min-h-[50vh] flex-col items-center justify-center lg:h-full lg:min-h-0">
                <Compass className="h-16 w-16 text-muted-foreground" />
                <h2 className="mt-4 font-serif text-[28px] font-medium text-espresso">
                  Find your next read
                </h2>
                <p className="mt-2 max-w-[400px] text-center text-base text-muted-foreground">
                  Discover and add new books to your shelf from here.
                </p>
              </div>
            </SmoothScrollArea>
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
