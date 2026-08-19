"use client";

import { startTransition, useActionState } from "react";
import { Loader2 } from "lucide-react";
import { submitDataRequest } from "@/lib/actions/data-requests";

/**
 * The form, and its one answer.
 *
 * Submitted by hand rather than through `action={action}` for the reason
 * `product-form.tsx` documents: React resets an uncontrolled form once a form
 * action completes, so an address typed and refused for a typo would vanish
 * along with the message telling the buyer to fix it.
 *
 * There is exactly one success state and it says nothing about what was found.
 */
export function DataRequestForm({
  handle,
  labels,
}: {
  handle: string;
  labels: {
    emailLabel: string;
    kindLabel: string;
    kindAccess: string;
    kindPortability: string;
    kindErasure: string;
    cta: string;
    received: string;
    note: string;
  };
}) {
  const [state, action, pending] = useActionState(submitDataRequest, { done: false });

  if (state.done) {
    return (
      <p
        role="status"
        className="surface-card mt-6 rounded-2xl p-4 text-sm leading-relaxed"
      >
        {labels.received}
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
      className="mt-6 space-y-4"
    >
      <input type="hidden" name="handle" value={handle} />

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">{labels.emailLabel}</span>
        <input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className="surface-elevated focus-ring-accent h-11 w-full rounded-xl px-3.5 text-sm outline-none"
        />
      </label>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium">{labels.kindLabel}</legend>
        <div className="space-y-2">
          {[
            { value: "access", label: labels.kindAccess },
            { value: "portability", label: labels.kindPortability },
            { value: "erasure", label: labels.kindErasure },
          ].map((option, index) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2.5 pointer-coarse:min-h-11"
            >
              <input
                type="radio"
                name="kind"
                value={option.value}
                defaultChecked={index === 0}
                className="mt-0.5 size-4 accent-ink-900 pointer-coarse:size-5"
              />
              <span className="text-sm">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="accent-bg focus-ring inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.cta}
      </button>

      <p className="text-xs leading-relaxed opacity-60">{labels.note}</p>
    </form>
  );
}
