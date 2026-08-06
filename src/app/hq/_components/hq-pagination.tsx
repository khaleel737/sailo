import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Page controls that keep every other filter in the URL.
 *
 * Real links, not buttons: a page of results is a place, and it should be
 * possible to open page three of "past due accounts" in a new tab or send it
 * to the other founder.
 */
export function Pagination({
  page,
  pages,
  total,
  noun,
  params,
  basePath,
}: {
  page: number;
  pages: number;
  total: number;
  /** Plural noun for the count line: "accounts", "orders". */
  noun: string;
  params: Record<string, string | undefined>;
  basePath: string;
}) {
  const href = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && value !== "all" && key !== "page") next.set(key, value);
    }
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const first = total === 0 ? 0 : (page - 1) * 25 + 1;
  const last = Math.min(page * 25, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="tabular text-xs text-ink-500">
        {total === 0
          ? `No ${noun}`
          : `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} ${noun}`}
      </p>

      {pages > 1 ? (
        <div className="flex items-center gap-1.5">
          <PageLink
            href={href(page - 1)}
            disabled={page <= 1}
            label="Previous page"
          >
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </PageLink>
          <span className="tabular px-2 text-xs font-medium text-ink-600">
            Page {page} of {pages}
          </span>
          <PageLink
            href={href(page + 1)}
            disabled={page >= pages}
            label="Next page"
          >
            <ChevronRight className="size-4 rtl:rotate-180" />
          </PageLink>
        </div>
      ) : null}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const className = cn(
    "focus-ring inline-flex size-8 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-600 shadow-xs transition",
    "pointer-coarse:size-11",
    disabled
      ? "pointer-events-none opacity-40"
      : "hover:border-ink-300 hover:text-ink-900",
  );

  if (disabled) {
    return (
      <span aria-disabled className={className}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={className}>
      {children}
    </Link>
  );
}
