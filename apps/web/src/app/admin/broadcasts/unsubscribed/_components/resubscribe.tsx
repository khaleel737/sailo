"use client";

import { startTransition, useActionState } from "react";
import { resubscribeAddress, type AudienceActionState } from "@/lib/actions/audience";
import { Alert, Button } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * The one button in this panel that undoes a promise made to somebody who is
 * not the seller.
 *
 * It carries a confirm, and the confirm asks the only question that matters:
 * did this person ask you to. The server refuses a bounce or a spam report
 * whatever this component does — rule 8 lives in the statement, not here — but
 * a seller should not have to be refused in order to learn what the rule is.
 */
export function Resubscribe({ email }: { email: string }) {
  const a = useAdminT();
  const [state, action] = useActionState<AudienceActionState, FormData>(
    resubscribeAddress,
    { ok: false },
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!window.confirm(a.broadcasts.resubscribeWarning)) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="email" value={email} />
      <Button type="submit" variant="ghost" size="sm">
        {a.broadcasts.resubscribe}
      </Button>
      {state.error ? (
        <Alert tone="error" className="mt-2 text-start">
          {state.error}
        </Alert>
      ) : null}
      {state.ok && state.message ? (
        <Alert tone="success" className="mt-2 text-start">
          {state.message}
        </Alert>
      ) : null}
    </form>
  );
}
