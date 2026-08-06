import { Skeleton } from "@/components/shared/skeleton";

/*
 * The landing page's hero, while it loads.
 *
 * This renders inside the group layout, which already draws the real header,
 * the real footer and the `.brand-surface` token scope. It used to draw a
 * skeleton header of its own too — correct when the nav lived in `page.tsx`,
 * and a second header stacked under the real one once it moved to the layout.
 *
 * Only the hero is drawn. Below the fold there is nothing to hold a place for,
 * and a full-page phantom of a nine-section marketing page reads as a broken
 * render rather than as a wait.
 */
export default function Loading() {
  return (
    <>
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
    </>
  );
}
