import { FormSkeleton, Skeleton } from "@/components/shared/skeleton";

/*
 * Sign in, sign up, and the two password screens.
 *
 * The layout owns the header, the panel beside it and the way out at the
 * bottom, and none of that is inside this boundary — so this only has to fill
 * the `max-w-[25rem]` column the form lands in.
 */
export default function Loading() {
  return (
    <div>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2.5 h-5 w-full max-w-xs" />
      <FormSkeleton className="mt-8" fields={2} />
      <Skeleton className="mt-6 h-12 w-full rounded-xl" />
      <Skeleton className="mx-auto mt-6 h-4 w-48" />
    </div>
  );
}
