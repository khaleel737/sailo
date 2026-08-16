import * as React from "react";
import { cn } from "./cn";

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
