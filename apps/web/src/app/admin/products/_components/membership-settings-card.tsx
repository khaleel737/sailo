"use client";

import { useState } from "react";
import { Card, Field, Input, Select, Textarea } from "@sailo/design-system/web";
import { Toggle } from "./toggle";
import { ChoiceGroup } from "./choice-group";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import {
  BILLING_INTERVALS,
  MAX_INTERVAL_COUNT,
  intervalCountOf,
  intervalOf,
  isBillingInterval,
  type BillingInterval,
} from "@sailo/commerce/memberships";
import { interpolate } from "@sailo/i18n";
import type { ProductWithRelations } from "./product.types";

/**
 * How often the member is charged, and whether they get a run-up first.
 *
 * It offered two cycles, monthly and yearly, which was a guess about what
 * sellers charge rather than anything Stripe imposed — a weekly class, a
 * fortnightly box and a quarterly subscription were all ordinary businesses
 * that could not be sold here. Stripe's model has always been an interval and
 * a count, so the third choice is not a new cycle but the pair, exposed.
 *
 * TWO PRESETS AND A DOOR
 *
 * Monthly and yearly stay one tap because between them they are nearly every
 * membership anybody sells. "Custom" opens the pair — every 2 weeks, every 3
 * months — rather than making a seller who wants the ordinary thing walk
 * through a number field to get it.
 *
 * The ceiling is Stripe's: a billing period may not exceed a year, expressed
 * per interval. Said on the field rather than discovered at checkout by a
 * buyer who cannot do anything about it.
 */

/** Which of the three the stored pair reads as. */
function presetFor(interval: BillingInterval, count: number) {
  if (count !== 1) return "custom" as const;
  if (interval === "month") return "month" as const;
  if (interval === "year") return "year" as const;
  return "custom" as const;
}

export function MembershipSettingsCard({
  product,
  currency,
  connected,
  membershipTerms = false,
}: {
  product?: ProductWithRelations;
  currency: string;
  /** Whether the shop can actually take a recurring card payment. */
  connected: boolean;
  /** Whether the plan includes fixed terms and pause — spec 49. */
  membershipTerms?: boolean;
}) {
  const a = useAdminT();
  const [accessAfterTerm, setAccessAfterTerm] = useState(
    () => product?.accessAfterTerm ?? false,
  );

  const savedInterval = product
    ? intervalOf(product)
    : ("month" as BillingInterval);
  const savedCount = product ? intervalCountOf(product) : 1;

  const [preset, setPreset] = useState(() => presetFor(savedInterval, savedCount));
  const [interval, setInterval] = useState<BillingInterval>(savedInterval);
  const [count, setCount] = useState(String(savedCount));

  /*
   * The two presets are the pair, not a third representation of it. Choosing
   * "Every month" *is* choosing (month, 1), so the same two hidden fields
   * carry all three cases and the server has one shape to read.
   */
  const effectiveInterval: BillingInterval =
    preset === "custom" ? interval : preset;
  const effectiveCount = preset === "custom" ? count : "1";

  const intervalNames: Record<BillingInterval, string> = {
    day: a.productForm.intervalDay,
    week: a.productForm.intervalWeek,
    month: a.productForm.intervalMonth,
    year: a.productForm.intervalYear,
  };

  const presets = [
    { value: "month" as const, label: a.productForm.everyMonth },
    { value: "year" as const, label: a.productForm.everyYear },
    { value: "custom" as const, label: a.productForm.everyCustom },
  ];

  const ceiling = MAX_INTERVAL_COUNT[effectiveInterval];

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.productForm.membershipTitle}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
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

      <input type="hidden" name="billingInterval" value={effectiveInterval} />
      <input type="hidden" name="billingIntervalCount" value={effectiveCount} />

      <Field label={a.productForm.billingInterval} help={a.productForm.billingIntervalHint}>
        <ChoiceGroup
          ariaLabel={a.productForm.billingInterval}
          value={preset}
          onChange={setPreset}
          options={presets}
        />
      </Field>

      {/*
        One control, not two fields. "Every 3 months" is a single answer, and
        splitting it into a labelled number beside a labelled dropdown made the
        seller assemble the sentence themselves — with the dropdown stretched
        across half the card for a word.
      */}
      {preset === "custom" ? (
        <Field
          label={a.productForm.everyCount}
          htmlFor="intervalCount"
          help={interpolate(a.productForm.intervalCeiling, {
            count: String(ceiling),
            unit: intervalNames[effectiveInterval],
          })}
        >
          <div className="flex items-center gap-2">
            <Input
              id="intervalCount"
              type="number"
              min={1}
              max={ceiling}
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              placeholder="3"
              className="w-20 shrink-0"
            />
            <Select
              id="intervalUnit"
              aria-label={a.productForm.everyUnit}
              value={interval}
              onChange={(e) => {
                const next = e.target.value;
                if (isBillingInterval(next)) setInterval(next);
              }}
              className="w-36"
            >
              {BILLING_INTERVALS.map((value) => (
                <option key={value} value={value}>
                  {intervalNames[value]}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      ) : null}

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
          connected ? a.productForm.trialDaysHint : a.productForm.trialDaysCardOnly
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

      {/*
        The one thing a seller will get wrong if nobody says it: changing the
        price does not change what existing members pay. That is Stripe's rule
        — a Price is immutable — and it is the right one, but it surprises
        people, so it belongs on the screen where the price is edited.
      */}
      <p className="text-xs leading-relaxed text-ink-500">
        {interpolate(a.productForm.membershipPriceNote, { currency })}
      </p>

      {/*
        Terms, policy and pause — spec 49.

        Rendered only on a plan that has them, and `saveProduct` falls back to
        null rather than refusing when it does not: a shop that downgrades keeps
        selling its memberships and simply stops offering new terms and freezes.
        A refusal would leave a seller unable to edit a title.
      */}
      {membershipTerms ? (
        <div className="space-y-4 border-t border-black/5 pt-4">
          <h3 className="text-[13px] font-medium text-ink-800">
            {a.productForm.termTitle}
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={a.productForm.termCycles}
              htmlFor="termCycles"
              help={a.productForm.termCyclesHint}
            >
              <Input
                id="termCycles"
                name="termCycles"
                inputMode="numeric"
                defaultValue={product?.termCycles ?? ""}
                placeholder="12"
              />
            </Field>
            <Field
              label={a.productForm.pauseMaxDays}
              htmlFor="pauseMaxDays"
              help={a.productForm.pauseMaxDaysHint}
            >
              <Input
                id="pauseMaxDays"
                name="pauseMaxDays"
                inputMode="numeric"
                defaultValue={product?.pauseMaxDays ?? ""}
                placeholder="30"
              />
            </Field>
          </div>

          <Toggle
            name="accessAfterTerm"
            label={a.productForm.accessAfterTerm}
            description={a.productForm.accessAfterTermHint}
            checked={accessAfterTerm}
            onChange={setAccessAfterTerm}
          />
        </div>
      ) : null}

      {/*
        The cancellation policy is **not** plan-gated, and that is deliberate:
        it is what a dispute is argued from through the policy snapshot, and a
        shop on any plan that cannot state its terms is a shop that loses
        chargebacks it should win.
      */}
      <div className="space-y-4 border-t border-black/5 pt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={a.productForm.minimumTermCycles}
            htmlFor="minimumTermCycles"
            help={a.productForm.minimumTermHint}
          >
            <Input
              id="minimumTermCycles"
              name="minimumTermCycles"
              inputMode="numeric"
              defaultValue={product?.minimumTermCycles ?? ""}
              placeholder="3"
            />
          </Field>
          <Field
            label={a.productForm.cancelNoticeDays}
            htmlFor="cancelNoticeDays"
            help={a.productForm.cancelNoticeHint}
          >
            <Input
              id="cancelNoticeDays"
              name="cancelNoticeDays"
              inputMode="numeric"
              defaultValue={product?.cancelNoticeDays ?? ""}
              placeholder="14"
            />
          </Field>
        </div>

        <Field
          label={a.productForm.cancelPolicyNote}
          htmlFor="cancelPolicyNote"
          help={a.productForm.cancelPolicyHint}
        >
          <Textarea
            id="cancelPolicyNote"
            name="cancelPolicyNote"
            rows={3}
            maxLength={2000}
            defaultValue={product?.cancelPolicyNote ?? ""}
          />
        </Field>
      </div>
    </Card>
  );
}
