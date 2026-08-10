"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import {
  confirmUnsubscribe,
  type UnsubscribeState,
} from "@/lib/actions/unsubscribe";

/**
 * One button, and it is a POST.
 *
 * The whole reason this is a form rather than a link: unsubscribing is a
 * write, and every URL in an email is fetched by something that is not the
 * recipient. Nothing here happens on load.
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

export function UnsubscribeForm({
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
  const [state, action] = useActionState<UnsubscribeState, FormData>(
    confirmUnsubscribe,
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
    <form action={action}>
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
