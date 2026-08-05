import * as React from "react";
import { cn } from "@/lib/utils";

/** Surfaces: card and section header. */

/* --------------------------------------------------------------------------
   Containers
-------------------------------------------------------------------------- */

export function Card({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-ink-200 bg-white shadow-sm",
        interactive && "lift cursor-pointer hover:border-ink-300",
        className,
      )}
      {...props}
    />
  );
}

/** Heading for a group of cards inside a page. */
export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("mb-3 flex flex-wrap items-end justify-between gap-3", className)}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-500">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
