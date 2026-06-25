import { ReaderMount } from "@/components/reader/reader-mount";

// ponytail: ReaderMount lives HERE (not in page.tsx) so it persists across [id]
// param changes. Next.js remounts the page subtree on every book change; the
// layout does not remount. This is what lets ReaderClient's swap choreography
// fire in place (prevBookIdRef survives) instead of silently bailing on a fresh
// mount. page.tsx now only does server-side auth + redirect and renders null.
export default function ReaderLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-scene="reader" + relative z-10: the SceneTransitionProvider slides
    // this element in from the right (xPercent 100→0). z-10 paints it above the
    // cloned-library underlay (z-0); bg-background stays opaque to cover the
    // receded clone at rest.
    <div data-scene="reader" className="relative z-10 h-screen w-screen overflow-hidden bg-background">
      <ReaderMount />
      {children}
    </div>
  );
}
