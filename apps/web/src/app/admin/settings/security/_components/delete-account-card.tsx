"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { TriangleAlert } from "lucide-react";
import { Alert, Button, Card, Field, Input } from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { deleteAccount, type DeleteAccountState } from "@/lib/actions/account";

const IDLE: DeleteAccountState = { ok: false };

function Submit({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="danger"
      size="sm"
      loading={pending}
      disabled={disabled}
    >
      {label}
    </Button>
  );
}

/**
 * The bottom of the Security tab. Two gates before anything happens: the
 * handle typed out by hand, and the password — the first stops the wrong
 * click, the second stops the wrong person.
 *
 * The refusal takes the whole `obligations` object rather than a boolean,
 * because there are three ways to be blocked and they are answered by three
 * different actions: ship or refund the orders, wait for the bank, or talk to
 * us about the hold. A single "you can't delete yet" would send every seller to
 * support to find out which one they were looking at.
 */
export function DeleteAccountCard({
  handle,
  obligations,
}: {
  handle: string;
  obligations: {
    blocked: boolean;
    count: number;
    openDisputes: number;
    payoutsHeld: boolean;
  };
}) {
  const a = useAdminT();
  const [state, action] = useActionState(deleteAccount, IDLE);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const matches = typed.trim().toLowerCase() === handle.toLowerCase();

  /*
   * Ordered by what the seller can act on soonest. Undelivered orders are
   * theirs to fix today; a dispute resolves on the network's clock; a payout
   * hold needs us. Showing the most actionable one first means the message on
   * screen is the one they can do something about.
   */
  const refusal = obligations.count > 0
    ? { title: a.security.deleteBlockedTitle, body: a.security.deleteBlockedBody }
    : obligations.openDisputes > 0
      ? {
          title: a.security.deleteBlockedDisputesTitle,
          body: a.security.deleteBlockedDisputesBody,
        }
      : obligations.payoutsHeld
        ? {
            title: a.security.deleteBlockedPayoutsTitle,
            body: a.security.deleteBlockedPayoutsBody,
          }
        : null;

  return (
    <Card className="space-y-4 border-red-200 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-red-700">
          <TriangleAlert className="size-4" />
          {a.security.deleteTitle}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
          {a.security.deleteBody}
        </p>
      </div>

      <ul className="space-y-1 text-xs leading-relaxed text-ink-500">
        <li>{interpolate(a.security.deleteReleases, { handle })}</li>
        <li>{a.security.deleteKeeps}</li>
      </ul>

      {refusal ? (
        <Alert tone="warning" title={refusal.title}>
          {refusal.body}
        </Alert>
      ) : open ? (
        <form action={action} className="space-y-3">
          {state.error ? <Alert>{state.error}</Alert> : null}

          <Field
            label={interpolate(a.security.deleteConfirmLabel, { handle })}
            htmlFor="delete-handle"
            error={typed && !matches ? a.security.deleteConfirmMismatch : undefined}
          >
            <Input
              id="delete-handle"
              name="handle"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>

          <Field label={a.security.yourPassword} htmlFor="delete-password">
            <Input
              id="delete-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>

          <div className="flex gap-2">
            <Submit label={a.security.deleteButton} disabled={!matches} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setTyped("");
              }}
            >
              {a.common.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() => setOpen(true)}
        >
          {a.security.deleteTitle}
        </Button>
      )}
    </Card>
  );
}
