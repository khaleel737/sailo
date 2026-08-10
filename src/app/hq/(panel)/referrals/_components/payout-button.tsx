"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import { markReferralPayout } from "@/lib/actions/referrals";

/**
 * "Mark paid" for one referrer's whole unpaid balance.
 *
 * The transfer is a human's job; this records that they did it. The button
 * disables itself while the action is in flight, and the action is idempotent
 * underneath — a second press stamps nothing and says so, rather than moving
 * the payout date on rows that were settled last month.
 */
function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" loading={pending}>
      {children}
    </Button>
  );
}

export function PayoutButton({
  shopId,
  disabled,
}: {
  shopId: string;
  /** Below the threshold — nothing to send yet. */
  disabled: boolean;
}) {
  const [state, action] = useActionState(markReferralPayout, { ok: false });

  if (disabled) {
    return <span className="text-xs text-ink-400">Below minimum</span>;
  }

  if (state.message) {
    return (
      <span className={state.ok ? "text-xs text-emerald-700" : "text-xs text-red-700"}>
        {state.message}
      </span>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="shopId" value={shopId} />
      {state.error ? (
        <span className="mr-2 text-xs text-red-700">{state.error}</span>
      ) : null}
      <Submit>Mark paid</Submit>
    </form>
  );
}
