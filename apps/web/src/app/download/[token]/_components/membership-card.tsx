"use client";

import { useFormStatus } from "react-dom";
import { BadgeCheck, Loader2, Settings2 } from "lucide-react";
import { openMembershipPortal } from "@/lib/actions/memberships";

/**
 * A member's own view of what they are paying for, and the way out.
 *
 * The way out is the point. A member who cannot find how to cancel does not
 * give up — they ring their bank, and a chargeback costs the seller the
 * month's money, the card fee, a dispute fee, and a mark against their Stripe
 * account. Making cancellation one obvious tap is cheaper for the seller than
 * hiding it, every time.
 *
 * The button leads to Stripe's own billing portal rather than a flow of ours:
 * they can change the card, see what they have paid and cancel, and none of
 * it is state we have to keep correct.
 */

export type MembershipLabels = {
  title: string;
  activeUntil: string;
  endingOn: string;
  pastDue: string;
  ended: string;
  manage: string;
  /** What a manual member is told instead — there is no portal to open. */
  manualRenew: string;
  manualPending: string;
};

function ManageButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="surface-elevated focus-ring-accent mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-70 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Settings2 className="size-4" />
      )}
      {label}
    </button>
  );
}

export function MembershipCard({
  token,
  title,
  status,
  open,
  endingSoon,
  until,
  manual = false,
  awaitingPayment = false,
  labels,
}: {
  token: string;
  /** What they subscribed to. */
  title: string;
  status: string;
  open: boolean;
  endingSoon: boolean;
  /** Already formatted in the shop's locale — the server owns that. */
  until: string | null;
  /** True when the shop collects by transfer, cash or chat rather than a card. */
  manual?: boolean;
  /** True when a renewal has been raised and is waiting to be paid. */
  awaitingPayment?: boolean;
  labels: MembershipLabels;
}) {
  /*
   * One sentence, chosen by what is actually true for them right now, with no
   * clever combination: paid up, leaving, waiting to pay, failed, over.
   *
   * The `past_due` line means two different things on the two rails, and
   * saying the card one to a bank-transfer member would be a lie.
   *
   * On a card, `past_due` is "we tried to charge you and it failed" — update
   * your card. On a manual rail it is "we have raised your next period and
   * are waiting for you to pay it", which is not a failure at all and needs
   * no apology; it needs the amount and the instructions.
   */
  const line = !open
    ? labels.ended
    : awaitingPayment
      ? labels.manualRenew.replace("{date}", until ?? "")
      : status === "past_due" && !manual
        ? labels.pastDue
        : endingSoon
          ? labels.endingOn.replace("{date}", until ?? "")
          : until
            ? labels.activeUntil.replace("{date}", until)
            : labels.title;

  return (
    <section className="surface-card mt-6 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <BadgeCheck
          className={`mt-0.5 size-5 shrink-0 ${open ? "opacity-70" : "opacity-30"}`}
          aria-hidden
        />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-muted mt-0.5 text-sm leading-relaxed">{line}</p>
        </div>
      </div>

      {/*
        The portal button is Stripe's, so it only exists where Stripe does.

        A member paying by transfer or cash has no card on file and no portal
        to open; pressing a button that led nowhere would be worse than not
        having one. What they get instead is the sentence that tells them the
        payment is arranged with the shop directly — which is the truth, and
        the same truth the renewal email carries.

        Shown even when a card membership has ended: that is when somebody most
        wants to check they are no longer being charged, and hiding it is how a
        member ends up unsure whether it really stopped.
      */}
      {manual ? (
        <p className="text-muted mt-4 text-xs leading-relaxed">
          {labels.manualPending}
        </p>
      ) : (
        <form action={openMembershipPortal}>
          <input type="hidden" name="token" value={token} />
          <ManageButton label={labels.manage} />
        </form>
      )}
    </section>
  );
}
