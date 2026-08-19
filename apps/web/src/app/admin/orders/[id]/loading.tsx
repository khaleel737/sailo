import {
  CardSkeleton,
  PageHeaderSkeleton,
  Skeleton,
} from "@sailo/design-system/web";

function Lines({ count }: { count: number }) {
  return (
    <div className="space-y-3 p-5">
      <Skeleton className="h-4 w-24" />
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

/** The detail page's shape, drawn before its data — a header, the two story
 *  cards, and the rail — so navigation lands somewhere rather than nowhere. */
export default function OrderLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <CardSkeleton>
            <Lines count={5} />
          </CardSkeleton>
          <CardSkeleton>
            <Lines count={4} />
          </CardSkeleton>
        </div>
        <div className="min-w-0 space-y-4">
          <CardSkeleton>
            <Lines count={3} />
          </CardSkeleton>
          <CardSkeleton>
            <Lines count={3} />
          </CardSkeleton>
        </div>
      </div>
    </>
  );
}
