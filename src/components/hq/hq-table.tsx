import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ===========================================================================
   The table every HQ list uses.

   Dense on purpose — the point of these pages is comparing rows, and generous
   padding means fewer of them on screen at once. Horizontal scroll is owned by
   the wrapper so a wide table never widens the page itself.
=========================================================================== */

export function Table({
  head,
  children,
  minWidth = "56rem",
  className,
}: {
  head: ReactNode;
  children: ReactNode;
  /** Below this the table scrolls sideways rather than crushing its columns. */
  minWidth?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-2xl border border-ink-200 bg-white shadow-sm",
        className,
      )}
    >
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead className="border-b border-ink-200 bg-ink-50/70 text-left">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-ink-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({
  children,
  align = "start",
  className,
}: {
  children?: ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-4 py-2.5 text-xs font-medium text-ink-500",
        align === "end" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "start",
  className,
}: {
  children?: ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-4 py-3 align-middle text-ink-700",
        align === "end" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr className={cn("transition-colors hover:bg-ink-50/60", className)}>
      {children}
    </tr>
  );
}

/** The row that says a filter matched nothing, without collapsing the table. */
export function EmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center text-sm text-ink-500">
        {children}
      </td>
    </tr>
  );
}
