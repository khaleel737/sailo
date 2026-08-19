import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Badge, Card } from "@sailo/design-system/web";
import { billingState, type BillingState, type CurrencyTotal } from "@/lib/metrics";
import { formatCurrencyTotals } from "@/lib/metrics";
import { formatMoney } from "@sailo/core/currency";
import { cn } from "@sailo/design-system/web/cn";

/* ===========================================================================
   The small pieces every HQ page is built from. All server components — none
   of this needs state, and keeping it that way means a page of forty rows
   ships no JavaScript for its rows.
=========================================================================== */

/** A headline number with the one qualifier that stops it being misread. */
export function Metric({
  label,
  value,
  hint,
  delta,
  href,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: { value: string; direction: "up" | "down" | "flat" };
  href?: string;
  icon?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-ink-400">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="tabular mt-2 text-2xl font-semibold text-ink-900">{value}</p>
      {delta ? (
        <p
          className={cn(
            "tabular mt-1 text-xs font-medium",
            delta.direction === "up"
              ? "text-emerald-600"
              : delta.direction === "down"
                ? "text-red-600"
                : "text-ink-400",
          )}
        >
          {delta.value}
        </p>
      ) : null}
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </>
  );

  if (href) {
    return (
      <Card interactive className="p-4">
        <Link href={href} className="focus-ring block rounded-xl">
          {body}
        </Link>
      </Card>
    );
  }
  return <Card className="p-4">{body}</Card>;
}

/**
 * Money that may be in several currencies at once. Never a fictional sum.
 *
 * Inline by default, which reads fine at hint size. `stacked` is for the
 * places this lands in a 2xl tile: three currencies run together in a headline
 * are a wall of glyphs nobody parses, and shrinking the type to fit them makes
 * the tile stop being a headline. So the biggest keeps the headline and the
 * rest drop to a line beneath it, which is the shape a figure with a
 * qualifier wants anyway. Every currency is in the `title` either way.
 */
export function Money({
  totals,
  limit = 2,
  className,
  stacked = false,
}: {
  totals: CurrencyTotal[];
  limit?: number;
  className?: string;
  /** Lead currency on its own line, the others small beneath it. */
  stacked?: boolean;
}) {
  const full = totals.map((t) => formatMoney(t.cents, t.currency)).join(" · ");

  if (!stacked) {
    return (
      <span className={cn("tabular", className)} title={full}>
        {formatCurrencyTotals(totals, limit)}
      </span>
    );
  }

  const [lead, ...rest] = totals;
  return (
    <span className={cn("tabular", className)} title={full}>
      <span className="block">
        {lead ? formatMoney(lead.cents, lead.currency) : formatMoney(0, "USD")}
      </span>
      {rest.length > 0 ? (
        <span className="mt-0.5 block truncate text-xs font-normal text-ink-500">
          {formatCurrencyTotals(rest, limit)}
        </span>
      ) : null}
    </span>
  );
}

const STATE_LABELS: Record<BillingState, string> = {
  comped: "Comped",
  paying: "Paying",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
  free: "Free",
};

const STATE_TONES = {
  comped: "blue",
  paying: "green",
  trialing: "brand",
  past_due: "amber",
  canceled: "red",
  free: "neutral",
} as const;

/** What an account is worth to us right now, in one chip. */
export function BillingBadge({
  shop,
  plan,
}: {
  shop: {
    plan: string;
    subscriptionStatus: string | null;
    subscriptionInterval: string | null;
    compPlan: string | null;
  };
  /** The entitled plan's display name, when it's worth naming alongside. */
  plan?: string;
}) {
  const state = billingState(shop);
  const label = STATE_LABELS[state];
  /*
   * "Free · Free" was on every free shop — which is most rows of the busiest
   * table in the panel. The plan name and the billing state are different facts
   * and usually different words ("Pro · Past due"), but when they are the same
   * word the separator is the only thing being communicated.
   */
  const text = plan && plan !== label ? `${plan} · ${label}` : label;

  return (
    <Badge tone={STATE_TONES[state]} dot>
      {text}
    </Badge>
  );
}


/** Label above, value below — the shape every detail card is made of. */
export function Detail({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs font-medium text-ink-400">{label}</p>
      <div className="mt-0.5 truncate text-sm text-ink-900">{children}</div>
    </div>
  );
}

/** An identifier we didn't choose — a Stripe id, a token. Monospaced. */
export function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-xs text-ink-600">{children}</span>
  );
}

/**
 * A Stripe object, linked into their dashboard where one exists.
 *
 * `truncate` with the full id in `title`, because these are 27+ characters and
 * a table column is not. Unbounded, the id ran under the edge of the payments
 * table and was cut mid-character — which reads as broken rendering rather than
 * as "this scrolls", and is the sort of thing that makes people stop trusting
 * the numbers next to it.
 */
export function StripeLink({
  id,
  kind,
  account,
}: {
  id: string | null;
  kind: "customers" | "subscriptions" | "payments" | "connect/accounts" | "disputes";
  /** The connected account the object lives under, if not the platform's. */
  account?: string | null;
}) {
  if (!id) return <span className="text-ink-400">—</span>;

  const base = "https://dashboard.stripe.com";
  const href = account
    ? `${base}/${account}/${kind}/${id}`
    : `${base}/${kind}/${id}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={id}
      className="focus-ring inline-flex max-w-full items-center gap-1 rounded font-mono text-xs text-ink-600 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-900"
    >
      <span className="truncate">{id}</span>
      <ArrowUpRight className="size-3 shrink-0" />
    </a>
  );
}

/**
 * The shop a row belongs to, linked to its account page.
 *
 * `flex-col items-start`, and the direction is the whole fix. This was
 * `flex items-center`, which makes the two spans *row* items — so `block` did
 * nothing and every table in the panel rendered "Parcel Shop/dnotice-315cd731"
 * as one run-on string. It looked like a missing separator and was a missing
 * axis; six pages carried it.
 */
export function ShopCell({
  ownerId,
  name,
  handle,
}: {
  ownerId: string;
  name: string;
  handle: string;
}) {
  return (
    <Link
      href={`/accounts/${ownerId}`}
      /*
       * `relative z-10` so this keeps working inside a row that is itself a
       * link. A `RowLink`'s overlay is a positioned pseudo-element and would
       * otherwise paint over this one — the shop would still look like a link,
       * and clicking it would open the row instead. Positioning costs nothing
       * on the rows that have no overlay.
       */
      className="focus-ring relative z-10 flex min-w-0 flex-col items-start justify-center rounded pointer-coarse:min-h-11"
    >
      <span className="max-w-full truncate font-medium text-ink-900">{name}</span>
      <span className="max-w-full truncate text-xs text-ink-400">/{handle}</span>
    </Link>
  );
}

/**
 * Turns a whole table row into a link, from inside the cell that names it.
 *
 * A list page whose rows open nothing is a list page people read and then go
 * looking for a search box. The row is the thing a person points at, so the
 * row is what should be clickable — but an `<a>` cannot be a child of `<tr>`:
 * the HTML parser hoists it straight out of the table and the row falls apart.
 *
 * So the anchor lives in the cell it genuinely belongs to and grows a `::after`
 * with no size of its own, which stretches to the nearest positioned ancestor.
 * That ancestor is the row, which is why every caller passes `className="relative"`
 * to its `<Tr>` — without it the overlay escapes to the page and covers
 * everything. Below `md` the row is a card and the same rule covers the card.
 *
 * Anything else clickable in the row has to sit above the overlay. `ShopCell`
 * already does; a new one needs `relative z-10` for the same reason.
 */
export function RowLink({
  href,
  children,
  label,
  className,
}: {
  href: string;
  children: ReactNode;
  /** What the row opens, for a reader who only hears the link. */
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "focus-ring rounded after:absolute after:inset-0 after:content-['']",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Compact absolute date. Relative times read as vague in an audit context. */
export function When({
  value,
  withTime = false,
}: {
  value: Date | string | null | undefined;
  withTime?: boolean;
}) {
  if (!value) return <span className="text-ink-400">—</span>;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return <span className="text-ink-400">—</span>;

  return (
    <time dateTime={date.toISOString()} className="tabular whitespace-nowrap">
      {date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}
      {withTime
        ? ` · ${date.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}`
        : ""}
    </time>
  );
}

/** A row of tiles that keeps its shape from two columns up to four. */
export function MetricRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
  );
}

/** Section heading inside a detail page. */
export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 mt-8 flex items-end justify-between gap-3">
      <h2 className="text-sm font-semibold text-ink-900">{children}</h2>
      {action}
    </div>
  );
}
