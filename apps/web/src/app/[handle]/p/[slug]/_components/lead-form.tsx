"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { captureLead, type LeadState } from "@/lib/actions/leads";
import type { Dictionary } from "@sailo/i18n";
import type { LeadQuestion } from "@sailo/db/schema";

const IDLE: LeadState = { done: false };

/**
 * A lead product's whole checkout — spec 07.
 *
 * There is no price, no quantity, no basket and no rail, because there is no
 * money: this replaces the buy panel rather than sitting beside it. What the
 * visitor gives is a name, an address and whatever the seller asked; what they
 * get is the file, if there is one.
 *
 * The `required` flags on the questions are rendered *and* enforced server-side
 * from the same `LeadQuestion[]`. A `required` attribute is a courtesy to an
 * honest visitor and nothing at all to a hand-rolled POST, so `readAnswers`
 * checks the same list — one source, two readers.
 */
export function LeadForm({
  productId,
  questions,
  askMarketingConsent,
  t,
}: {
  productId: string;
  questions: LeadQuestion[];
  /** The shop's own switch — spec 05. Absent, the box is never shown. */
  askMarketingConsent: boolean;
  t: Dictionary;
}) {
  const [state, action] = useActionState(captureLead, IDLE);

  /*
   * The success state replaces the form entirely.
   *
   * Leaving the fields on screen underneath a "thanks" is how somebody submits
   * twice — and the second submission is throttled, so it answers with the same
   * sentence and they cannot tell whether anything happened.
   */
  if (state.done) {
    return (
      <div
        role="status"
        className="surface-elevated rounded-2xl p-5 text-sm font-medium"
      >
        {state.message ?? t.lead.thanks}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="productId" value={productId} />

      <div>
        <label htmlFor="lead-name" className="mb-1.5 block text-sm font-medium">
          {t.checkout.yourName}
        </label>
        <input
          id="lead-name"
          name="name"
          autoComplete="name"
          maxLength={120}
          className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none"
        />
      </div>

      <div>
        <label htmlFor="lead-email" className="mb-1.5 block text-sm font-medium">
          {t.checkout.email}
        </label>
        <input
          id="lead-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          maxLength={200}
          className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none"
        />
      </div>

      {questions.map((question) => (
        <div key={question.id}>
          <label
            htmlFor={`lead-${question.id}`}
            className="mb-1.5 block text-sm font-medium"
          >
            {question.label}
            {!question.required ? (
              <span className="text-muted ml-1 text-xs font-normal">
                {t.common.optional}
              </span>
            ) : null}
          </label>
          <textarea
            id={`lead-${question.id}`}
            name={`answer:${question.id}`}
            required={question.required}
            rows={2}
            maxLength={1000}
            className="surface-elevated w-full rounded-xl px-3 py-2 text-sm outline-none"
          />
        </div>
      ))}

      {askMarketingConsent ? (
        <label className="flex cursor-pointer items-start gap-2.5 pt-1">
          <input
            type="checkbox"
            name="marketingOptIn"
            className="mt-0.5 size-4 shrink-0 rounded"
          />
          <span className="text-muted text-xs leading-relaxed">
            {t.checkout.marketingOptIn}
          </span>
        </label>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <Submit label={t.lead.submit} busy={t.lead.sending} />

      <p className="text-muted text-xs">{t.lead.privacy}</p>
    </form>
  );
}

/**
 * `useFormStatus` reports on the form it is rendered inside, which is why this
 * is a component rather than a flag on the one above.
 */
function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="press h-12 w-full rounded-xl bg-[var(--accent)] text-sm font-semibold text-[var(--accent-contrast)] disabled:opacity-60"
    >
      {pending ? busy : label}
    </button>
  );
}
