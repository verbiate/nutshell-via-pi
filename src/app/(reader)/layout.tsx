export default function ReaderLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-scene="reader" + relative z-10: the SceneTransitionProvider slides
    // this element in from the right (xPercent 100→0). z-10 paints it above the
    // cloned-library underlay (z-0); bg-background stays opaque to cover the
    // receded clone at rest.
    <div data-scene="reader" className="relative z-10 h-screen w-screen overflow-hidden bg-background">
      {children}
    </div>
  );
}
