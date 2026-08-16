"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus, X } from "lucide-react";
import { addClient, type ClientActionState } from "@/lib/actions/clients";
import { Alert, Button, Card, Field, Input } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * Typing somebody into the list by hand.
 *
 * The consent line is not decoration. A seller adding contacts is usually
 * doing it in order to email them, and the one thing they cannot do that way
 * is grant consent on somebody else's behalf — so the form says it here,
 * before the work, rather than letting them discover it from a broadcast that
 * reached nobody.
 */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function AddContact({ vocabulary }: { vocabulary: string[] }) {
  const a = useAdminT();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ClientActionState, FormData>(addClient, {
    ok: false,
  });

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {a.clients.add}
      </Button>
    );
  }

  return (
    <Card className="w-full space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{a.clients.add}</h2>
          <p className="mt-0.5 text-xs text-ink-500">{a.clients.addBody}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={a.common.cancel}
          onClick={() => setOpen(false)}
        >
          <X className="size-4" />
        </Button>
      </div>

      <form action={action} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={a.columns.client} htmlFor="name">
            <Input id="name" name="name" maxLength={120} autoComplete="off" />
          </Field>
          <Field label={a.clients.email} htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="off" />
          </Field>
          <Field label={a.clients.phone} htmlFor="phone">
            <Input id="phone" name="phone" type="tel" autoComplete="off" />
          </Field>
          <Field label={a.clients.tags} htmlFor="new-tags">
            <Input id="new-tags" name="tags" list="tag-vocabulary" autoComplete="off" />
          </Field>
        </div>

        <datalist id="tag-vocabulary">
          {vocabulary.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </datalist>

        <Field label={a.clients.note} htmlFor="notes">
          <Input id="notes" name="notes" maxLength={2000} autoComplete="off" />
        </Field>

        <Alert tone="info">{a.clients.addConsentNote}</Alert>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <Submit label={a.clients.add} />
      </form>
    </Card>
  );
}
