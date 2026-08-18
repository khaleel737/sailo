"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { PauseCircle, Send, Undo2 } from "lucide-react";
import {
  refundDisputedCharge,
  releasePayoutHold,
  stageDisputeEvidence,
  submitDisputeEvidence,
} from "@/lib/actions/disputes";
import { Alert, Button } from "@sailo/design-system/web";
import type { ActionState } from "@sailo/core/action-state";

/* ===========================================================================
   The buttons that answer a chargeback, and the one that gives a seller their
   payouts back.

   Every one of them posts a row id and nothing else. The evidence is assembled
   server-side from the order at the moment of sending — a browser that could
   post evidence fields is a browser that could post a shipping date nobody
   shipped on, into a document that goes to a bank.
=========================================================================== */

const IDLE: ActionState = { ok: false };

function Submit({
  children,
  variant = "secondary",
  icon,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  icon?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} loading={pending}>
      {icon}
      {children}
    </Button>
  );
}

function Result({ state }: { state: ActionState }) {
  if (!state.error && !state.message) return null;
  return (
    <Alert tone={state.ok ? "success" : "error"} className="mt-2">
      {state.error ?? state.message}
    </Alert>
  );
}

/**
 * Send the answer. One shot, and the copy says so.
 *
 * Stripe accepts exactly one submitted response per dispute; the second is not a
 * replacement, it is a rejection. So this is the primary button and the draft is
 * the secondary one, which is the reverse of the usual ordering and deliberate:
 * the irreversible action is the one people are here to take, and hiding it
 * behind the reversible one gets it pressed by muscle memory.
 */
export function SendEvidence({
  disputeId,
  complete,
}: {
  disputeId: string;
  /** Whether every required field is held. Changes the tone, not the ability. */
  complete: boolean;
}) {
  const [state, action] = useActionState(submitDisputeEvidence, IDLE);
  return (
    <form action={action} className="inline-block">
      <input type="hidden" name="disputeId" value={disputeId} />
      <Submit variant={complete ? "primary" : "secondary"} icon={<Send className="size-4" />}>
        {/*
          An incomplete answer is still worth sending — a submission with gaps
          beats no submission, and an empty response is an automatic loss. So the
          button never disables; it only stops looking like the confident choice.
        */}
        {complete ? "Send answer" : "Send anyway"}
      </Submit>
      <Result state={state} />
    </form>
  );
}

/** Save the document to Stripe without answering the case. */
export function StageEvidence({ disputeId }: { disputeId: string }) {
  const [state, action] = useActionState(stageDisputeEvidence, IDLE);
  return (
    <form action={action} className="inline-block">
      <input type="hidden" name="disputeId" value={disputeId} />
      <Submit variant="ghost">Save draft</Submit>
      <Result state={state} />
    </form>
  );
}

/**
 * Refund instead of arguing — only ever offered on an enquiry.
 *
 * On a chargeback the money has already gone and a refund pays the buyer twice.
 * The server refuses that case regardless; not rendering the button is so nobody
 * has to find out from an error message.
 */
export function RefundInstead({ disputeId }: { disputeId: string }) {
  const [state, action] = useActionState(refundDisputedCharge, IDLE);
  return (
    <form action={action} className="inline-block">
      <input type="hidden" name="disputeId" value={disputeId} />
      <Submit variant="ghost" icon={<Undo2 className="size-4" />}>
        Refund instead
      </Submit>
      <Result state={state} />
    </form>
  );
}

/**
 * Give a shop its payouts back.
 *
 * `clear` is a separate, unchecked box rather than part of the button, because
 * they are two different decisions: "let this payout run" and "I have looked at
 * this shop and it is fine". Merging them means every release silently exempts
 * the shop from the next two chargebacks' worth of assessment.
 */
export function ReleaseHold({ shopId }: { shopId: string }) {
  const [state, action] = useActionState(releasePayoutHold, IDLE);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="shopId" value={shopId} />
      <label className="flex items-start gap-2 text-sm text-ink-600">
        <input
          type="checkbox"
          name="clear"
          className="mt-0.5 size-4 rounded border-ink-300"
        />
        <span>
          I have looked at this shop and it is fine.
          <span className="block text-xs text-ink-500">
            Stops the next assessment re-applying the hold, until two more
            chargebacks arrive.
          </span>
        </span>
      </label>
      {/*
        `aria-label`, because a placeholder is not a label: it is announced
        inconsistently, and it disappears the moment somebody types — leaving a
        filled box with nothing saying what is in it.
      */}
      <input
        type="text"
        name="note"
        aria-label="Why the payout hold is being released"
        placeholder="Why (goes on the account's record)"
        className="focus-ring w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm"
      />
      <Submit icon={<PauseCircle className="size-4" />}>Release payouts</Submit>
      <Result state={state} />
    </form>
  );
}
