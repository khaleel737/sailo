import { FormSkeleton, Skeleton } from "@/components/shared/skeleton";

/*
 * The affiliate's way in, and the report behind it. One centred column, so a
 * single fallback covers this route and `[token]` under it.
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-2.5 h-5 w-full" />
        <FormSkeleton className="mt-8" fields={1} />
        <Skeleton className="mt-6 h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}
