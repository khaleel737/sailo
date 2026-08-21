"use client";

import { useFormStatus } from "react-dom";
import { ArrowUpRight, Loader2 } from "lucide-react";

/**
 * The Connect / Continue-on-Stripe button, with the wait made visible.
 *
 * Pressing it runs a server action that creates the connected account and mints
 * a single-use onboarding link — a few sequential Stripe round trips before the
 * browser can be redirected. Without a pending state the button did nothing
 * visible for those seconds, which reads as slow or broken; `useFormStatus`
 * turns the same wait into a spinner and a "Connecting…" line. `disabled` while
 * pending also stops a second press minting a second account.
 *
 * A client component so it can read the enclosing form's pending state; the
 * form and its `action` stay on the server card.
 */
export function StripeConnectButton({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={className}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        <>
          {label}
          <ArrowUpRight className="size-4 rtl:-scale-x-100" />
        </>
      )}
    </button>
  );
}
