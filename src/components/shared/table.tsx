import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ===========================================================================
   The table both panels use.

   Dense on purpose — the point of a list page is comparing rows, and generous
   padding means fewer of them on screen at once.

   Below `md` it stops being a table and becomes a list of cards. This is not
   decoration: a five-column row needs ~46rem, so on a 390px phone a sideways
   scroll shows the first column and hides price, stock, status and the row's
   own buttons behind a gesture nobody discovers. Sailo's sellers run their
   shops from a phone, so the phone layout has to show the whole row.

   The flip is driven by one rule, applied by `Td`:

     labelled cell    -> a "Label      value" line inside the card
     unlabelled cell  -> a full-width block

   which makes the title cell and the actions cell fall out correctly without
   either of them needing a special case.

   This started life in /hq. It is here because a seller comparing forty
   products wants exactly what a staff member comparing forty accounts wants,
   and two copies of that would drift.
=========================================================================== */

export function Table({
  head,
  children,
  minWidth = "56rem",
  className,
}: {
  head: ReactNode;
  children: ReactNode;
  /** Between `md` and this the table scrolls sideways rather than crushing
      its columns. Below `md` it does not apply — there are no columns left. */
  minWidth?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-ink-200 bg-white shadow-sm",
        // Sideways scroll is the tablet-and-up story. Below md the rows are
        // cards, so a scroll container there would only clip the shadow.
        "max-md:overflow-visible md:overflow-x-auto",
        className,
      )}
    >
      <table
        // The floor lives in a custom property so a media query can drop it;
        // an inline `style` min-width cannot be turned off below a breakpoint.
        style={{ "--table-min": minWidth } as CSSProperties}
        className="w-full text-sm max-md:block max-md:min-w-0 md:min-w-(--table-min)"
      >
        <thead className="border-b border-ink-200 bg-ink-50/70 text-left max-md:hidden">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-ink-100 max-md:block">{children}</tbody>
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
  label,
  className,
}: {
  children?: ReactNode;
  align?: "start" | "end" | "center";
  /**
   * What this cell is, for the card layout — normally the column heading.
   *
   * Omit it for the cell that names the row and for the cell holding the row's
   * buttons: both read as themselves inside a card, and a label on either
   * would be noise.
   */
  label?: string;
  className?: string;
}) {
  return (
    <td
      data-label={label}
      className={cn(
        "px-4 py-3 align-middle text-ink-700",
        align === "end" && "text-right",
        align === "center" && "text-center",
        label
          ? [
              "max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-4",
              "max-md:px-0 max-md:py-1 max-md:text-start",
              // The heading comes from the attribute rather than a second
              // element, so the desktop table carries no extra markup.
              "max-md:before:whitespace-nowrap max-md:before:text-xs",
              "max-md:before:font-medium max-md:before:text-ink-500",
              "max-md:before:content-[attr(data-label)]",
            ]
          : // No `text-start` reset here: the title cell is start-aligned
            // already, and the actions cell keeps the end alignment that puts
            // its buttons where a thumb expects them.
            "max-md:block max-md:px-0 max-md:py-1",
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
    <tr
      className={cn(
        "transition-colors hover:bg-ink-50/60",
        // The card: its own padding, and a gap between the row's name and the
        // facts underneath it.
        "max-md:block max-md:space-y-0.5 max-md:p-4",
        className,
      )}
    >
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
    <tr className="max-md:block">
      <td
        colSpan={colSpan}
        className="px-4 py-14 text-center text-sm text-ink-500 max-md:block"
      >
        {children}
      </td>
    </tr>
  );
}
