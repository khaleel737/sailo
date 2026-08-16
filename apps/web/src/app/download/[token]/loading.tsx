import { Skeleton } from "@sailo/design-system/web";

/*
 * The download page, mid-load. It is reached from an email link straight after
 * paying, so the wait is the most anxious one on the site — the card holds its
 * shape rather than leaving the buyer on an empty screen wondering.
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <Skeleton className="size-14 rounded-2xl" />
          <Skeleton className="mt-4 h-7 w-52" />
          <Skeleton className="mt-2.5 h-4 w-64" />
        </div>
        <div className="mt-8 space-y-3">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
