"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import {
  confirmNewsletter,
  type NewsletterConfirmState,
} from "@/lib/actions/newsletter";

/**
 * One button, and it is a POST.
 *
 * Nothing happens on load. Every URL in an email is fetched by scanners and
 * corporate security gateways, so a confirmation that acted on render would
 * subscribe people who never opened the message — which is exactly the consent
 * this page exists to establish.
 */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="focus-line mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--r-pill)] bg-[var(--ink)] text-sm font-medium text-[var(--paper)] transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {label}
    </button>
  );
}

export function NewsletterConfirmForm({
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
  const [state, formAction] = useActionState<NewsletterConfirmState, FormData>(
    confirmNewsletter,
    { done: false },
  );

  if (state.done) {
    return (
      <div role="status" className="mt-7">
        <p className="text-base font-semibold text-[var(--ink)]">{doneTitle}</p>
        <p className="mt-1 text-[0.9375rem] leading-[1.7] text-[var(--mute-600)]">
          {doneBody}
        </p>
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
