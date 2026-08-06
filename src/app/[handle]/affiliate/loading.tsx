import { Skeleton } from "@/components/shared/skeleton";

/* The affiliate sign-up, mid-load. A single centred card, as `page.tsx` is. */
export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[560px] px-4 pb-20 pt-12 sm:pt-16">
        <div className="flex flex-col items-center text-center">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="mt-4 h-7 w-56" />
          <Skeleton className="mt-2.5 h-4 w-full max-w-sm" />
        </div>
        <div className="mt-8 space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i}>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-1.5 h-11 w-full rounded-xl" />
            </div>
          ))}
          <Skeleton className="mt-2 h-11 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}
