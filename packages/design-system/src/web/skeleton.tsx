import { cn } from "./cn";

/* ===========================================================================
   Loading skeletons

   Every shape here is measured off the component it stands in for, because a
   fallback that is the wrong size is worse than none: the content lands, the
   page jumps, and the layout shift is charged to Core Web Vitals.

     PageHeader   mb-6, h1 text-xl/28px, description text-sm/22.75px at mt-1.5
     Card         rounded-2xl border-ink-200
     Table        thead py-2.5 + text-xs = 36px, rows px-4 py-3 + text-sm = 44px

   All of it is `aria-hidden`. A skeleton describes nothing, and announcing a
   dozen empty boxes is worse for a screen reader than announcing nothing —
   the one "loading" message belongs to the progress bar in the root layout,
   which is a live region and is translated.

   Server components: a fallback that has to hydrate before it can paint is not
   a fallback. Nothing in this file ships JavaScript.
=========================================================================== */

/** One shimmering bar. `w`/`h` are Tailwind classes so callers can size it. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} />;
}

/** Mirrors `<PageHeader>` — title, optional description, optional action. */
export function PageHeaderSkeleton({
  description = true,
  action = false,
}: {
  description?: boolean;
  action?: boolean;
}) {
  return (
    <div aria-hidden className="mb-6 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-7 w-44" />
        {description ? <Skeleton className="mt-1.5 h-[22px] w-full max-w-sm" /> : null}
      </div>
      {action ? <Skeleton className="h-10 w-32 shrink-0 rounded-xl" /> : null}
    </div>
  );
}

/** The `<Card>` shell, so the border and radius land before the content does. */
export function CardSkeleton({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-2xl border border-ink-200 bg-white shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The `<Table>` shell at its real row height.
 *
 * Below `md` the real table renders each row as a card rather than a row, so
 * this does the same — otherwise the phone gets a 44px-per-row placeholder and
 * then a 120px-per-card reality.
 */
export function TableSkeleton({
  rows = 6,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <CardSkeleton className="overflow-hidden">
      <div className="border-b border-ink-200 bg-ink-50/70 px-4 py-2.5 max-md:hidden">
        <div className="flex gap-4">
          {Array.from({ length: cols }, (_, i) => (
            <Skeleton
              key={i}
              className={cn("h-4", i === 0 ? "w-40 flex-1" : "w-24")}
            />
          ))}
        </div>
      </div>

      <div className="divide-y divide-ink-100">
        {Array.from({ length: rows }, (unusedRow, r) => (
          <div key={r} className="px-4 py-3 max-md:space-y-2 max-md:py-4">
            <div className="flex items-center gap-4 max-md:flex-col max-md:items-stretch max-md:gap-2">
              {Array.from({ length: cols }, (_, i) => (
                <Skeleton
                  key={i}
                  className={cn(
                    "h-5",
                    i === 0 ? "w-48 flex-1 max-md:w-40" : "w-24",
                    // Past the second column a phone shows nothing but the
                    // row's name and one fact, so neither should this.
                    i > 1 && "max-md:hidden",
                  )}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </CardSkeleton>
  );
}

/** The stat strip the dashboards open with — four `<Stat>` cards in a grid. */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      aria-hidden
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} className="p-5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-3 h-8 w-28" />
        </CardSkeleton>
      ))}
    </div>
  );
}

/** A stack of labelled inputs, at the height `<Field>` renders them. */
export function FormSkeleton({
  fields = 4,
  className,
}: {
  fields?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("space-y-4", className)}>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i}>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-1.5 h-11 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Whole-page shapes

   The three silhouettes every panel screen resolves to. Keeping them here and
   not in thirteen `loading.tsx` files means a change to `<PageHeader>` or
   `<Table>` is one edit, not a hunt.
--------------------------------------------------------------------------- */

/** Header, then a table. Orders, products, clients, and most of HQ. */
export function TablePageSkeleton({
  cols = 4,
  rows = 6,
  action = true,
}: {
  cols?: number;
  rows?: number;
  action?: boolean;
}) {
  return (
    <>
      <PageHeaderSkeleton action={action} />
      <TableSkeleton cols={cols} rows={rows} />
    </>
  );
}

/** Header, then stacked cards of fields. Settings, payments, the editors. */
export function FormPageSkeleton({
  sections = 2,
  fields = 4,
  action = false,
}: {
  sections?: number;
  fields?: number;
  action?: boolean;
}) {
  return (
    <>
      <PageHeaderSkeleton action={action} />
      <div className="space-y-4">
        {Array.from({ length: sections }, (_, i) => (
          <CardSkeleton key={i} className="p-5">
            <Skeleton className="h-5 w-32" />
            <FormSkeleton className="mt-4" fields={fields} />
          </CardSkeleton>
        ))}
      </div>
    </>
  );
}

/** Header, stat strip, a chart, then a short list. Both overview screens. */
export function DashboardSkeleton({ stats = 4 }: { stats?: number }) {
  return (
    <>
      <PageHeaderSkeleton action />
      <StatGridSkeleton count={stats} />
      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {/* Matches `<Chart>`: a label row over a fixed-height plot. */}
        <CardSkeleton className="p-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-4 h-40 w-full rounded-lg" />
        </CardSkeleton>
        <CardSkeleton className="p-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-4 h-40 w-full rounded-lg" />
        </CardSkeleton>
      </div>
      <div className="mt-6">
        <TableSkeleton cols={4} rows={5} />
      </div>
    </>
  );
}
