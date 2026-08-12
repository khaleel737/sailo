"use client";

import { Card, Field, Input, Select } from "@/components/ui";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { BILLING_INTERVALS } from "@/lib/memberships";
import type { ProductWithRelations } from "./product.types";

/**
 * How often the member is charged, and whether they get a run-up first.
 *
 * Two fields, because a membership needs exactly two things the catalogue does
 * not already hold: how often, and how long before the first charge. The price
 * is the ordinary price field — it just means "per interval" now, which the
 * hint says out loud rather than leaving a seller to guess whether £30 is a
 * month or a year.
 */
export function MembershipSettingsCard({
  product,
  currency,
  connected,
}: {
  product?: ProductWithRelations;
  currency: string;
  /** Whether the shop can actually take a recurring card payment. */
  connected: boolean;
}) {
  const a = useAdminT();

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.productForm.membershipTitle}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">
          {a.productForm.membershipBody}
        </p>
      </div>

      {/*
        Not a warning any more — a description of which cycle this shop gets.

        It used to say a membership was unsellable without Stripe, which was
        true when it was card-only and is now simply wrong: a shop taking bank
        transfers or cash sells memberships perfectly well, and Sailo runs the
        renewal cycle for them. Telling a seller their product will not work,
        when it will, is worse than saying nothing.
      */}
      {connected ? null : (
        <p className="rounded-xl bg-ink-50 px-3 py-2.5 text-xs leading-relaxed text-ink-600">
          {a.productForm.membershipNeedsStripe}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={a.productForm.billingInterval}
          htmlFor="billingInterval"
          help={a.productForm.billingIntervalHint}
        >
          <Select
            id="billingInterval"
            name="billingInterval"
            defaultValue={product?.billingInterval ?? "month"}
          >
            {BILLING_INTERVALS.map((interval) => (
              <option key={interval} value={interval}>
                {interval === "month"
                  ? a.productForm.everyMonth
                  : a.productForm.everyYear}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={a.productForm.trialDays}
          htmlFor="trialDays"
          hint={a.common.optional}
          /*
           * A trial is Stripe's `trial_period_days` and nothing else reads it.
           * On a manual rail the member is asked for the first period at
           * signup, so a seller who sets this on a cash membership has
           * configured something that does nothing — which they should hear
           * from the field, not from a confused member.
           */
          help={
            connected
              ? a.productForm.trialDaysHint
              : a.productForm.trialDaysCardOnly
          }
        >
          <Input
            id="trialDays"
            name="trialDays"
            type="number"
            min={0}
            max={365}
            defaultValue={product?.trialDays ?? ""}
            placeholder="0"
            className="sm:w-32"
          />
        </Field>
      </div>

      {/*
        The one thing a seller will get wrong if nobody says it: changing the
        price does not change what existing members pay. That is Stripe's rule
        — a Price is immutable — and it is the right one, but it surprises
        people, so it belongs on the screen where the price is edited.
      */}
      <p className="text-xs leading-relaxed text-ink-500">
        {a.productForm.membershipPriceNote.replace("{currency}", currency)}
      </p>
    </Card>
  );
}
