import { Skeleton } from "@/components/shared/skeleton";

/*
 * The landing page.
 *
 * Sibling to the root `page.tsx`, so it covers `/` and any route that has not
 * declared a fallback of its own — the token pages under /invoice, /download
 * and /partner, all of which open on a single centred card.
 *
 * Only the hero is drawn. Below the fold there is nothing to hold a place for,
 * and a full-page phantom of a nine-section marketing page reads as a broken
 * render rather than as a wait.
 */
export default function Loading() {
  return (
    <div className="brand-surface flex min-h-[100dvh] flex-col">
      {/* Header: the lockup, then the nav that sits opposite it. */}
      <div className="mx-auto flex w-full max-w-[78rem] items-center justify-between px-5 py-4 sm:px-8">
        <Skeleton className="h-5 w-24" />
        <div className="flex items-center gap-6 max-lg:hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-20" />
          ))}
        </div>
        <Skeleton className="h-11 w-36 rounded-full" />
      </div>

      {/* Hero: eyebrow pill, three display lines, lede, then the two CTAs. */}
      <div className="mx-auto grid w-full max-w-[78rem] items-center gap-16 px-5 pb-20 pt-16 sm:px-8 sm:pb-28 lg:grid-cols-[1.08fr_auto] lg:gap-14 lg:pt-24">
        <div>
          <Skeleton className="h-8 w-44 rounded-full" />
          <div className="mt-8 space-y-3">
            <Skeleton className="h-14 w-full max-w-2xl sm:h-16" />
            <Skeleton className="h-14 w-full max-w-xl sm:h-16" />
            <Skeleton className="h-14 w-full max-w-lg sm:h-16" />
          </div>
          <Skeleton className="mt-7 h-6 w-full max-w-[34rem]" />
          <Skeleton className="mt-2 h-6 w-full max-w-[28rem]" />
          <div className="mt-9 flex flex-wrap gap-3">
            <Skeleton className="h-13 w-52 rounded-full" />
            <Skeleton className="h-13 w-44 rounded-full" />
          </div>
        </div>
        {/* The phone mock-up alongside it, at its rendered aspect. */}
        <Skeleton className="mx-auto hidden aspect-[9/17] w-[17rem] rounded-[2.5rem] lg:block" />
      </div>
    </div>
  );
}
