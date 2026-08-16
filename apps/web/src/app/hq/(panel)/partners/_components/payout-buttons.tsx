"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@sailo/design-system/web";
import {
  markPartnerPaidManually,
  payPartnerNow,
  runPayoutsNow,
} from "@/lib/actions/partner-program";

/**
 * The three buttons that settle a balance.
 *
 * None of them carries an amount. Every one of these actions recomputes what
 * is owed from the ledger at the moment it runs, because a figure posted by a
 * browser is a figure an operator was looking at some minutes ago — and the
 * gap between that and what is really owed is the whole reason a balance is a
 * sum of rows rather than a stored number.
 */
function Submit({
  children,
  variant = "secondary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} loading={pending}>
      {children}
    </Button>
  );
}

/** Result text, shared by all three — success green, refusal red. */
function Result({ state }: { state: { ok: boolean; message?: string; error?: string } }) {
  if (state.error) {
    return <span className="text-xs text-red-700">{state.error}</span>;
  }
  if (state.message) {
    return (
      <span className={state.ok ? "text-xs text-emerald-700" : "text-xs text-amber-700"}>
        {state.message}
      </span>
    );
  }
  return null;
}

/** Sends one partner their balance now, rather than waiting for the run. */
export function PayNowButton({
  partnerId,
  currency,
}: {
  partnerId: string;
  currency: string;
}) {
  const [state, action] = useActionState(payPartnerNow, { ok: false });

  if (state.message || state.error) return <Result state={state} />;

  return (
    <form action={action}>
      <input type="hidden" name="partnerId" value={partnerId} />
      <input type="hidden" name="currency" value={currency} />
      <Submit variant="primary">Send now</Submit>
    </form>
  );
}

/**
 * Runs the whole batch.
 *
 * The amount is in the label rather than in the form, so an operator can see
 * what they are about to authorise without it becoming the number that gets
 * sent.
 */
export function RunPayoutsButton({
  disabled,
  amount,
  count,
}: {
  disabled: boolean;
  amount: string;
  count: number;
}) {
  const [state, action] = useActionState(runPayoutsNow, { ok: false });

  if (state.message || state.error) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Result state={state} />
      </div>
    );
  }

  if (disabled) {
    return <span className="text-xs text-ink-400">Nothing to send</span>;
  }

  return (
    <form action={action}>
      <Submit variant="primary">
        Send {amount} to {count} partner{count === 1 ? "" : "s"}
      </Submit>
    </form>
  );
}

/**
 * Records a payment made outside Stripe — a wire, a correction, a partner in a
 * country Connect can't reach.
 *
 * It stamps rows and writes a payout row for the record; it moves no money,
 * which is said on the button rather than buried in a tooltip. Without it a
 * blocked balance can never be cleared and the payouts page grows a permanent
 * row nobody can action.
 */
export function MarkSettledButton({ partnerId }: { partnerId: string }) {
  const [state, action] = useActionState(markPartnerPaidManually, { ok: false });

  if (state.message || state.error) return <Result state={state} />;

  return (
    <form action={action}>
      <input type="hidden" name="partnerId" value={partnerId} />
      <Submit>Mark settled (no money moves)</Submit>
    </form>
  );
}
