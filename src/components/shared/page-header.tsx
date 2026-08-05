import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Every admin page opens the same way: where you are, what this page is for,
 * and the one action it exists to enable. `back` appears only on pages you
 * reach a level down — the sidebar covers the rest.
 */
export function PageHeader({
  title,
  description,
  action,
  back,
  meta,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  back?: { href: string; label: string };
  /** Chips, counts or status that qualify the title. */
  meta?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {back ? (
        <Link
          href={back.href}
          className="focus-ring -ms-1 mb-2 inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-sm font-medium text-ink-500 transition hover:text-ink-900"
        >
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {back.label}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-500">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
