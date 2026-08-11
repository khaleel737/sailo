import { Skeleton } from "@/components/shared/skeleton";

/*
 * The storefront, mid-load.
 *
 * This is the page a buyer lands on straight from an Instagram bio, usually on
 * a phone on mobile data, and it is the one route where a blank screen costs a
 * sale. The shapes below trace `page.tsx` exactly — same 680px measure, same
 * 96px avatar, same two-column product grid — so when the real content arrives
 * nothing jumps.
 *
 * No accent colour anywhere: the shop's palette is a per-shop value that only
 * arrives with the data, and guessing it would mean a visible repaint.
 */
export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[680px] px-4 pb-20 pt-12 sm:pt-16">
        <header className="flex flex-col items-center text-center">
          <Skeleton className="size-24 rounded-full" />
          <Skeleton className="mt-4 h-7 w-48" />
          <Skeleton className="mt-2.5 h-4 w-full max-w-sm" />
          <Skeleton className="mt-1.5 h-4 w-40" />

          {/* The social row. */}
          <div className="mt-5 flex gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="size-9 rounded-full" />
            ))}
          </div>
        </header>

        {/* The filter bar. */}
        <div className="mt-10 flex gap-2 overflow-hidden">
          {["w-16", "w-24", "w-20", "w-28"].map((w) => (
            <Skeleton key={w} className={`h-9 shrink-0 rounded-full ${w}`} />
          ))}
        </div>

        {/* The catalogue: two across on a phone, as the real grid is. */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-ink-200">
              <Skeleton className="aspect-square w-full rounded-none" />
              <div className="p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-2 h-4 w-1/3" />
                <Skeleton className="mt-3 h-9 w-full rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
