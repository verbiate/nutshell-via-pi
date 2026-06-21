'use client';

import { Skeleton } from '@/components/ui/skeleton';

// ponytail: fade duration for the page-content reveal (skeleton dissolves to
// expose the rendered EPUB beneath). See reader-client.tsx — the skeleton is
// held opaque until isLoaded && !entering, then fades out so the cover is the
// last thing that moves before the page appears.
const FADE_MS = 200;

export function ReaderSkeleton({
  visible = true,
  onFadeOut,
}: {
  visible?: boolean;
  onFadeOut?: () => void;
}) {
  return (
    <div
      onTransitionEnd={(e) => {
        if (e.propertyName === 'opacity' && !visible) onFadeOut?.();
      }}
      className="absolute inset-0 z-60 flex flex-col items-center justify-center bg-background transition-opacity"
      style={{
        opacity: visible ? 1 : 0,
        transitionDuration: `${FADE_MS}ms`,
        transitionTimingFunction: 'cubic-bezier(.5, 0, .2, 1)',
      }}
    >
      <div className="flex flex-col items-center gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
        <div className="mt-8 space-y-3 w-[300px]">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-[92%]" />
          <Skeleton className="h-3 w-[96%]" />
          <Skeleton className="h-3 w-[88%]" />
          <Skeleton className="h-3 w-[94%]" />
        </div>
      </div>
    </div>
  );
}
