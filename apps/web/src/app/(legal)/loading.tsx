import { Skeleton } from "@sailo/design-system/web";

/*
 * Terms, privacy, refunds. The layout keeps the header and the document tabs;
 * this stands in for the prose under them.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[46rem] px-5 py-14 sm:px-8">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="mt-3 h-4 w-40" />
      <div className="mt-10 space-y-8">
        {Array.from({ length: 4 }, (_, section) => (
          <div key={section}>
            <Skeleton className="h-6 w-52" />
            <div className="mt-3 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
