import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { billingState, type BillingState, type CurrencyTotal } from "@/lib/hq-metrics";
import { formatCurrencyTotals } from "@/lib/hq-metrics";
import { cn, formatMoney } from "@/lib/utils";

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

/** Money that may be in several currencies at once. Never a fictional sum. */
export function Money({
  totals,
  limit = 2,
  className,
}: {
  totals: CurrencyTotal[];
  limit?: number;
  className?: string;
}) {
  return (
    <span className={cn("tabular", className)} title={totals
      .map((t) => formatMoney(t.cents, t.currency))
      .join(" · ")}>
      {formatCurrencyTotals(totals, limit)}
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
  return (
    <Badge tone={STATE_TONES[state]} dot>
      {plan ? `${plan} · ${STATE_LABELS[state]}` : STATE_LABELS[state]}
    </Badge>
  );
}

export function StateLabel({ state }: { state: BillingState }) {
  return <>{STATE_LABELS[state]}</>;
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

/** A Stripe object, linked into their dashboard where one exists. */
export function StripeLink({
  id,
  kind,
  account,
}: {
  id: string | null;
  kind: "customers" | "subscriptions" | "payments" | "connect/accounts";
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
      className="focus-ring inline-flex items-center gap-1 rounded font-mono text-xs text-ink-600 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-900"
    >
      {id}
      <ArrowUpRight className="size-3 shrink-0" />
    </a>
  );
}

/** The shop a row belongs to, linked to its account page. */
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
      href={`/hq/accounts/${ownerId}`}
      className="focus-ring flex min-w-0 items-center rounded pointer-coarse:min-h-11"
    >
      <span className="block truncate font-medium text-ink-900">{name}</span>
      <span className="block truncate text-xs text-ink-400">/{handle}</span>
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
