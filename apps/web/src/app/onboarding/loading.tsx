import { FormSkeleton, Skeleton } from "@sailo/design-system/web";

/*
 * The multi-step shop setup. Matches the `max-w-4xl` column it renders in,
 * with the step rail above the fields.
 */
export default function Loading() {
  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:py-12">
      <Skeleton className="h-5 w-24" />
      <div className="mt-10 flex items-center gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-2 flex-1 rounded-full" />
        ))}
      </div>
      <Skeleton className="mt-10 h-9 w-72" />
      <Skeleton className="mt-2.5 h-5 w-full max-w-md" />
      <FormSkeleton className="mt-8 max-w-lg" fields={3} />
      <Skeleton className="mt-8 h-12 w-40 rounded-xl" />
    </div>
  );
}
