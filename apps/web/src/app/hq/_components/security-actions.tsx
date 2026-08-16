"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, LogOut, ShieldOff } from "lucide-react";
import {
  clearAccountTwoFactor,
  revokeAccountApiKey,
  revokeAccountSession,
  revokeAccountSessions,
} from "@/lib/actions/hq";
import { Alert, Button, Card, Field, Input } from "@sailo/design-system/web";
import type { ActionState } from "@/lib/actions/shop";

/* ===========================================================================
   The buttons that take an account back.

   Shared between the security page and an account's own page, because they are
   the same act from two directions: you arrive at a suspicious session either
   from the platform-wide list or from the seller who emailed about it, and
   whichever way you came the thing you press is the same.

   Every one of them posts a row id and nothing else. No token, no key, no
   secret travels through the browser — the server resolves the id under
   `requireStaff` and writes the audit row before it returns.
=========================================================================== */

const IDLE: ActionState = { ok: false };

function Submit({
  children,
  variant = "secondary",
  size = "sm",
}: {
  children: React.ReactNode;
  variant?: "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} variant={variant} loading={pending}>
      {children}
    </Button>
  );
}

/** One device, signed out. Sits in a table row, so it reports inline. */
export function RevokeSession({ sessionId }: { sessionId: string }) {
  const [state, action] = useActionState(revokeAccountSession, IDLE);

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="sessionId" value={sessionId} />
      <Submit variant="ghost">Sign out</Submit>
      {state.error ? (
        <p className="text-xs font-medium text-red-600">{state.error}</p>
      ) : null}
    </form>
  );
}

/**
 * Every device at once — the first move on a compromised account, so it is one
 * press rather than a row-by-row sweep of a table that may be growing.
 */
export function RevokeAllSessions({
  userId,
  count,
}: {
  userId: string;
  count: number;
}) {
  const [state, action] = useActionState(revokeAccountSessions, IDLE);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="userId" value={userId} />
      <Submit variant="danger">
        <LogOut className="size-3.5" />
        Sign out {count === 1 ? "the one device" : `all ${count} devices`}
      </Submit>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}
    </form>
  );
}

/**
 * Clearing a second factor is the one thing on this page that makes an account
 * easier to get into, so it asks for the reason in the same form rather than
 * confirming afterwards — the sentence you type is what the audit trail keeps,
 * and "support call, verified last four of the card" is the whole point of it.
 */
export function ClearTwoFactor({
  userId,
  locked,
  failedAttempts,
}: {
  userId: string;
  locked: boolean;
  failedAttempts: number;
}) {
  const [state, action] = useActionState(clearAccountTwoFactor, IDLE);
  const fieldId = useId();

  return (
    <Card className="p-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="userId" value={userId} />

        <div className="flex items-center gap-2">
          <ShieldOff className="size-4 text-ink-400" />
          <h3 className="text-sm font-semibold text-ink-900">
            Clear two-factor
          </h3>
        </div>

        <p className="text-xs leading-relaxed text-ink-500">
          For a lost authenticator with the backup codes gone too — the one
          lockout with no way out from their side. Every signed-in device is
          signed out with it, and they get an email saying so.
        </p>

        {locked ? (
          <Alert tone="warning">
            The plugin has this account locked out after too many wrong codes.
            It lifts on its own; clearing is for when the codes are gone for
            good, not for waiting one out.
          </Alert>
        ) : failedAttempts > 0 ? (
          <Alert tone="warning">
            {failedAttempts} wrong{" "}
            {failedAttempts === 1 ? "code has" : "codes have"} been tried. If
            that wasn&rsquo;t them, sign the devices out first and ask them to
            change their password.
          </Alert>
        ) : null}

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <Field label="Why, and how you know it's them" htmlFor={fieldId}>
          <Input
            id={fieldId}
            name="reason"
            required
            placeholder="Called from the number on file, confirmed last order…"
          />
        </Field>

        <Submit variant="danger">Clear it</Submit>
      </form>
    </Card>
  );
}

/** Kills one API key. The seller can do this themselves; we can do it faster. */
export function RevokeApiKey({ keyId }: { keyId: string }) {
  const [state, action] = useActionState(revokeAccountApiKey, IDLE);

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="keyId" value={keyId} />
      <Submit variant="ghost">
        <KeyRound className="size-3.5" />
        Revoke
      </Submit>
      {state.error ? (
        <p className="text-xs font-medium text-red-600">{state.error}</p>
      ) : null}
    </form>
  );
}
