"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card } from "@sailo/design-system/web";
import { acceptTeamInvitation } from "@/lib/actions/team-accept";
import type { ActionState } from "@sailo/core/action-state";

const IDLE: ActionState = { ok: false };

const WHAT: Record<string, string> = {
  manager:
    "Run the shop day to day — products, orders, refunds, customers and marketing. Not payouts, not settings, and not inviting anybody else.",
  staff:
    "Handle orders and customers, and see the catalogue. No refunds, no exports, no marketing.",
};

/**
 * What accepting would mean, said before the button.
 *
 * The role names are the seller's vocabulary and mean nothing on their own to
 * the person being invited, so the sentence under each is the actual answer to
 * "what am I agreeing to". Copy in English here rather than in the storefront
 * dictionary: this page is neither a storefront nor the admin, and adding a
 * thirty-fifth-language surface for two sentences is a cost this does not
 * carry yet — the admin screen that sends the invitation is translated.
 */
export function AcceptInvite({
  id,
  organizationName,
  role,
  matchesYou,
  invitedEmail,
}: {
  id: string;
  organizationName: string;
  role: string;
  matchesYou: boolean;
  invitedEmail: string;
}) {
  const [state, action] = useActionState(acceptTeamInvitation, IDLE);

  if (state.ok) {
    return (
      <Card className="space-y-3 p-6 text-center">
        <h1 className="text-lg font-semibold tracking-tight">You're in</h1>
        <p className="text-sm text-ink-500">
          {organizationName} is in your admin now.
        </p>
        <a href="/admin" className="inline-block text-sm font-medium underline">
          Open the shop
        </a>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Help run {organizationName}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {WHAT[role] ?? "You would be able to work in this shop."}
        </p>
      </div>

      {matchesYou ? null : (
        /*
         * Said before the button rather than after a refusal: somebody signed
         * in on the wrong account would otherwise press accept, be turned away
         * with a message they cannot act on, and have no idea which address to
         * use.
         */
        <Alert tone="warning">
          This invitation was sent to {invitedEmail}. Sign in with that address
          to accept it.
        </Alert>
      )}

      <form action={action}>
        <input type="hidden" name="invitationId" value={id} />
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <Submit disabled={!matchesYou} />
      </form>
    </Card>
  );
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={disabled}>
      Accept
    </Button>
  );
}
