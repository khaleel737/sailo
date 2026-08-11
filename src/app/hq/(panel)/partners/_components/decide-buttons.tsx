"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import { decidePartner } from "@/lib/actions/partner-program";

/**
 * Approve / reject / suspend / reinstate, inline in the roster.
 *
 * The decision that is offered depends on where the partner already is, so
 * nobody is presented with a button that would be a no-op — "approve" on an
 * approved partner and "reject" on a rejected one are both noise, and both
 * invite a misclick that writes an audit line for nothing.
 *
 * Rejection and suspension carry no note from here on purpose. A one-line
 * reason typed into a table cell is worse than none; the detail page has a
 * field with room for a sentence, and this offers a link to it.
 */
function Submit({
  decision,
  children,
  variant = "secondary",
}: {
  decision: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      size="sm"
      variant={variant}
      loading={pending}
    >
      {children}
    </Button>
  );
}

export function DecideButtons({
  partnerId,
  status,
}: {
  partnerId: string;
  status: string;
}) {
  const [state, action] = useActionState(decidePartner, { ok: false });

  if (state.error) {
    return <span className="text-xs text-red-700">{state.error}</span>;
  }
  if (state.message) {
    return <span className="text-xs text-emerald-700">{state.message}</span>;
  }

  return (
    <form action={action} className="flex flex-wrap justify-end gap-1.5">
      <input type="hidden" name="partnerId" value={partnerId} />

      {status === "pending" ? (
        <>
          <Submit decision="approved" variant="primary">
            Approve
          </Submit>
          <Submit decision="rejected">Reject</Submit>
        </>
      ) : status === "approved" ? (
        <Submit decision="suspended">Suspend</Submit>
      ) : (
        // Rejected or suspended: the only move left is letting them back in,
        // which keeps the code they already have so posted links keep working.
        <Submit decision="approved" variant="primary">
          Reinstate
        </Submit>
      )}
    </form>
  );
}
