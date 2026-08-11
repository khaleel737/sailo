import { Skeleton } from "@/components/shared/skeleton";
import { Container } from "@/components/marketing/kit";

/* The index, mid-load: one lead card over a two-across grid, as `page.tsx` is. */
export default function Loading() {
  return (
    <>
      <Container className="py-16 sm:py-24">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="mt-4 h-5 w-full max-w-2xl" />
        <div className="mt-14 space-y-12">
          <Skeleton className="aspect-[1200/630] w-full rounded-[var(--r-card)]" />
          <div className="grid gap-8 sm:grid-cols-2">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="aspect-[1200/630] w-full rounded-[var(--r-card)]" />
            ))}
          </div>
        </div>
      </Container>
    </>
  );
}
