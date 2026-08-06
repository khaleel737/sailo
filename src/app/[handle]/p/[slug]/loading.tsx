import { Skeleton } from "@/components/shared/skeleton";

/*
 * A product, mid-load. Traces `page.tsx`: the gallery is a square that becomes
 * the photograph, and the buy button keeps its place so the page does not
 * shuffle under a thumb already reaching for it.
 */
export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[680px] px-4 pb-20 pt-6">
        <Skeleton className="h-5 w-28" />

        <Skeleton className="mt-5 aspect-square w-full rounded-2xl" />

        {/* Thumbnail strip. */}
        <div className="mt-3 flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="size-16 rounded-xl" />
          ))}
        </div>

        <Skeleton className="mt-6 h-8 w-2/3" />
        <Skeleton className="mt-3 h-7 w-28" />

        <div className="mt-5 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>

        <Skeleton className="mt-7 h-12 w-full rounded-full" />

        <div className="mt-12">
          <Skeleton className="h-6 w-32" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
