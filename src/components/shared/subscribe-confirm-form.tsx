"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { confirmSubscription, type ConfirmState } from "@/lib/actions/subscribe";

/**
 * One button, and it is a POST.
 *
 * The mirror of `unsubscribe-form.tsx`, and separate from it for the same
 * reason the two actions are separate: they write opposite things, and a
 * shared component taking "which direction" as a prop would put that choice
 * on the client, where the page it came from is the only thing that knows.
 *
 * Nothing happens on load. Every URL in an email is fetched by scanners and
 * security gateways, so a confirmation that acted on render would subscribe
 * people who never opened the message — which is exactly the consent this
 * page exists to establish.
 */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="accent-bg focus-ring mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </button>
  );
}

export function SubscribeConfirmForm({
  token,
  label,
  doneTitle,
  doneBody,
}: {
  token: string;
  label: string;
  doneTitle: string;
  doneBody: string;
}) {
  const [state, formAction] = useActionState<ConfirmState, FormData>(
    confirmSubscription,
    { done: false },
  );

  if (state.done) {
    return (
      <div role="status" className="mt-6">
        <p className="text-base font-semibold">{doneTitle}</p>
        <p className="text-muted mt-1 text-sm leading-relaxed">{doneBody}</p>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <Submit label={label} />
      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
