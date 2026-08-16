import { CardSkeleton, Skeleton } from "@sailo/design-system/web";

/*
 * The receipt a buyer opens from their order link. Fixed chrome — no seller
 * theme — so the fallback can match the real document line for line.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-ink-50 px-4 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <CardSkeleton className="p-8">
          <div className="flex items-start justify-between gap-6">
            <div>
              <Skeleton className="h-6 w-40" />
              <Skeleton className="mt-2 h-4 w-32" />
            </div>
            <Skeleton className="h-10 w-24 rounded-xl" />
          </div>
          <div className="mt-10 space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-6">
                <Skeleton className="h-5 w-full max-w-xs" />
                <Skeleton className="h-5 w-20 shrink-0" />
              </div>
            ))}
          </div>
          <div className="ms-auto mt-8 max-w-xs space-y-1.5 border-t border-ink-100 pt-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-6">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </CardSkeleton>
      </div>
    </div>
  );
}
