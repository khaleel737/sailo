"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import type { ArrivalState } from "@/lib/actions/arrival";

/**
 * One button, and it is a POST.
 *
 * The same reason the unsubscribe form is a form: every URL in an email is
 * fetched by something that is not the recipient — spam scanners, link
 * previewers, corporate gateways — and this one writes a fact that ends up in
 * evidence submitted to a card network. A GET here would file a delivery
 * confirmation on behalf of a buyer who never opened the message.
 */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="accent-bg focus-ring mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      {label}
    </button>
  );
}

export function ArrivalForm({
  action,
  token,
  label,
  doneTitle,
  doneBody,
  alreadyBody,
  unavailable,
  invalid,
}: {
  action: (prev: ArrivalState, formData: FormData) => Promise<ArrivalState>;
  token: string;
  label: string;
  doneTitle: string;
  doneBody: string;
  /** Shown when this click was not the one that recorded it. */
  alreadyBody: string;
  /** The limiter could not be asked. Not an answer about the order. */
  unavailable: string;
  invalid: string;
}) {
  const [state, formAction] = useActionState<ArrivalState, FormData>(action, {
    done: false,
  });

  if (state.done) {
    return (
      <div className="mt-6">
        <h2 className="text-base font-semibold">{doneTitle}</h2>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          {/*
            A second click is not a failure and must not read as one. The claim
            underneath is conditional, so whoever confirmed first is what the
            record says — this only changes the sentence.
          */}
          {state.already ? alreadyBody : doneBody}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <Submit label={label} />
      {state.error ? (
        <p className="text-muted mt-3 text-sm leading-relaxed" role="status">
          {/*
            `unavailable` and `invalid` are deliberately different sentences.
            The limiter failing closed means nothing was checked, and telling a
            buyer holding a real link that it opens nothing would be a negative
            answer to a question nobody asked — rule 5.
          */}
          {state.error === "invalid" ? invalid : unavailable}
        </p>
      ) : null}
    </form>
  );
}
