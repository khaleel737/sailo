"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card, EmptyState } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { askForTestimonials } from "@/lib/actions/testimonials";
import type { ActionState } from "@sailo/core/action-state";

const IDLE: ActionState = { ok: false };

/**
 * Asking past buyers.
 *
 * The copy under the heading names both ceilings before the seller presses the
 * button, because the result message names them afterwards — and one of them,
 * "these people unsubscribed", is not something waiting will fix.
 */
export function AskCard({
  contacts,
}: {
  contacts: { id: string; name: string; email: string | null }[];
}) {
  const a = useAdminT();
  const [state, action] = useActionState(askForTestimonials, IDLE);
  const askable = contacts.filter((c) => c.email);

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.testimonials.askTitle}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.testimonials.askBody}</p>
      </div>

      {askable.length === 0 ? (
        <EmptyState title={a.testimonials.askEmpty} />
      ) : (
        <form action={action} className="space-y-3">
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-ink-200 p-2">
            {askable.map((contact) => (
              <label
                key={contact.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50 pointer-coarse:min-h-11"
              >
                <input
                  type="checkbox"
                  name="clientId"
                  value={contact.id}
                  className="size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
                />
                <span className="min-w-0 flex-1 truncate">
                  {contact.name}
                  <span className="ml-2 text-xs text-ink-500">{contact.email}</span>
                </span>
              </label>
            ))}
          </div>

          {state.error ? <Alert tone="error">{state.error}</Alert> : null}
          {state.ok && state.message ? (
            <Alert tone="success">{state.message}</Alert>
          ) : null}

          <Submit label={a.testimonials.askCta} />
        </form>
      )}
    </Card>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}
