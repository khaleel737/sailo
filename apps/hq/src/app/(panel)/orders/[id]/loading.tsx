/*
 * Shown while one order streams in. Sibling to `page.tsx`, so the list this
 * was opened from is replaced immediately rather than after every join lands —
 * the page fans out to a dozen tables and the slowest of them would otherwise
 * decide when anything at all appears.
 *
 * Not `FormPageSkeleton`: this page opens with a four-across summary card and
 * a table of what was bought, and a silhouette that promises stacked forms
 * makes the real thing look like it jumped.
 */
import {
  CardSkeleton,
  PageHeaderSkeleton,
  Skeleton,
  TableSkeleton,
} from "@sailo/design-system/web";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />

      <CardSkeleton className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (unused, i) => (
          <div key={i}>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-1.5 h-5 w-28" />
          </div>
        ))}
      </CardSkeleton>

      <div className="mt-8">
        <TableSkeleton cols={5} rows={3} />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <CardSkeleton className="space-y-2.5 p-4">
          {Array.from({ length: 5 }, (unused, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </CardSkeleton>
        <CardSkeleton className="grid gap-4 p-4 sm:grid-cols-2">
          {Array.from({ length: 6 }, (unused, i) => (
            <div key={i}>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-1.5 h-5 w-32" />
            </div>
          ))}
        </CardSkeleton>
      </div>
    </>
  );
}
