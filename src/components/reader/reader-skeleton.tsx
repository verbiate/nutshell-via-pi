'use client';

import { Skeleton } from '@/components/ui/skeleton';

export function ReaderSkeleton() {
  return (
    <div className="absolute inset-0 z-60 flex flex-col items-center justify-center bg-background">
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
