"use client";

/**
 * Selling a ticket at the door to somebody who never bought one.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { addWalkUp } from "@/lib/actions/tickets";
import type { CheckInState } from "@sailo/commerce/ticketing";
import { Button, Card, Field, Input } from "@sailo/design-system/web";
import type { CheckinLabels } from "./labels";

export function WalkUpForm({
  scope,
  labels: a,
  onDone,
  onCancel,
}: {
  scope: { productId: string; token: string | null };
  labels: CheckinLabels;
  onDone: (state: CheckInState) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-ink-900">{a.addGuest}</p>
      <p className="mt-1 text-xs text-ink-500">{a.addGuestBody}</p>

      <form
        className="mt-4 space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          try {
            onDone(await addWalkUp({ ...scope, name, email }));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={a.guestName} htmlFor="walkup-name">
          <Input
            id="walkup-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            autoComplete="off"
          />
        </Field>
        <Field label={a.guestEmail} htmlFor="walkup-email">
          <Input
            id="walkup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {a.addAndAdmit}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {a.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
