"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, X } from "lucide-react";
import {
  cancelMembership,
  type MembershipState,
} from "@/lib/actions/memberships";
import { Alert, Badge, Button } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@sailo/i18n";
import { formatMoney } from "@/lib/utils";
import type { Subscription } from "@sailo/db/schema";

/**
 * One member, and the one irreversible thing a seller can do to them.
 *
 * Cancel is a quiet ghost button rather than a red one, because it is not
 * destructive in the way a delete is: nothing is lost, the member keeps what
 * they paid for, and Stripe simply stops renewing. Dressing it as a danger
 * would make a seller hesitate over an action that is entirely reversible
 * right up until the period ends.
 */

const TONES = {
  active: "green",
  trialing: "blue",
  past_due: "amber",
  canceled: "neutral",
  unpaid: "red",
  incomplete: "neutral",
} as const;

function CancelButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button variant="ghost" size="sm" type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
      {label}
    </Button>
  );
}

export function MemberRow({
  subscription,
  name,
  email,
  productTitle,
  locale,
}: {
  subscription: Subscription;
  name: string | null;
  email: string | null;
  productTitle: string | null;
  locale: string;
}) {
  const a = useAdminT();
  const [state, cancel] = useActionState<MembershipState, FormData>(
    cancelMembership,
    { ok: false },
  );

  const status = subscription.status as keyof typeof TONES;
  const manual = subscription.billingMode === "manual";
  const money = formatMoney(subscription.priceCents, subscription.currency, locale);
  const price =
    subscription.interval === "year"
      ? interpolate(a.members.yearly, { amount: money })
      : interpolate(a.members.monthly, { amount: money });

  /*
   * Cancelling is offered while the arrangement can still be stopped, which
   * is not the same as "while it is active": a `past_due` member is still
   * being billed by Stripe and still needs a way out, and one already
   * cancelled has nothing left to cancel.
   */
  const stoppable =
    !subscription.cancelAtPeriodEnd &&
    ["active", "trialing", "past_due"].includes(subscription.status);

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-900">
            {name || a.members.noEmail}
          </p>
          <p className="truncate text-xs text-ink-400">
            {email ?? a.members.noEmail}
            {productTitle ? ` · ${productTitle}` : ""}
          </p>
        </div>

        <div className="text-end">
          <p className="tabular text-sm font-medium text-ink-900">{price}</p>
          <p className="text-xs text-ink-400">
            {subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd
              ? interpolate(a.members.endsOn, {
                  date: subscription.currentPeriodEnd.toLocaleDateString(locale, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }),
                })
              : subscription.currentPeriodEnd
                ? `${a.members.renews} ${subscription.currentPeriodEnd.toLocaleDateString(
                    locale,
                    { day: "numeric", month: "short" },
                  )}`
                : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge tone={TONES[status] ?? "neutral"}>
            {/*
              A manual membership sitting `past_due` has not failed at
              anything — it has been asked for and not yet paid, which is an
              ordinary state on a bank transfer and reads as an error in the
              card path's words.
            */}
            {manual && subscription.status === "past_due"
              ? a.members.awaitingPayment
              : (a.memberStatus[status] ?? subscription.status)}
          </Badge>
          <Badge tone="neutral">
            {manual ? a.members.byHand : a.members.byCard}
          </Badge>
          {subscription.cancelAtPeriodEnd ? (
            <Badge tone="amber">{a.members.cancelling}</Badge>
          ) : null}

          {stoppable ? (
            <form action={cancel}>
              <input type="hidden" name="id" value={subscription.id} />
              <CancelButton label={a.members.cancel} />
            </form>
          ) : null}
        </div>
      </div>

      {state.error ? (
        <Alert tone="error" className="mt-3">
          {state.error}
        </Alert>
      ) : null}
      {state.ok && state.message ? (
        <Alert tone="success" className="mt-3">
          {state.message}
        </Alert>
      ) : null}
    </div>
  );
}
