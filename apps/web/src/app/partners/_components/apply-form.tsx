"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Field, Input, Textarea } from "@sailo/design-system/web";
import { applyToPartnerProgram } from "@/lib/actions/partner-program";

/**
 * The application.
 *
 * Four fields, one of them required. A partner programme's application form is
 * a conversion funnel like any other, and every extra required field is people
 * who would have promoted us and didn't finish the form — so the optional ones
 * are there for the applicant who wants to make a case, not as a gate.
 *
 * The name is prefilled from their account and still editable: a lot of people
 * promote under a brand rather than the name on their card.
 */
function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      Apply to the programme
    </Button>
  );
}

export function ApplyForm({
  name,
  accepting,
  share,
}: {
  name: string;
  /** False when /hq has closed the programme to new applications. */
  accepting: boolean;
  share: string;
}) {
  const [state, action] = useActionState(applyToPartnerProgram, { ok: false });

  if (!accepting) {
    return (
      <div className="rounded-2xl bg-ink-50 p-6">
        <h2 className="text-lg font-semibold text-ink-900">
          Applications are closed right now
        </h2>
        <p className="mt-1 text-sm text-ink-600">
          We&rsquo;ve paused new partners while we catch up. Check back soon.
        </p>
      </div>
    );
  }

  // The success message is the whole answer — an approved applicant's link
  // appears on the next render, and a queued one has nothing else to do here.
  if (state.ok && state.message) {
    return <Alert tone="success" title={state.message} />;
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">
          Apply to the programme
        </h2>
        <p className="mt-1 text-sm text-ink-600">
          Tell us where you&rsquo;ll be sharing Sailo. If you already run a
          paying shop with us, you&rsquo;re approved instantly.
        </p>
      </div>

      {state.error ? <Alert tone="error" title={state.error} /> : null}

      <Field label="Name or brand" htmlFor="partner-name">
        <Input
          id="partner-name"
          name="name"
          required
          maxLength={120}
          defaultValue={name}
          placeholder="Your name, or what you publish as"
        />
      </Field>

      <Field
        label="Where you'll share it"
        htmlFor="partner-website"
        hint="Optional"
        help="A site, channel, newsletter or profile — whatever we should look at."
      >
        <Input
          id="partner-website"
          name="website"
          type="url"
          maxLength={300}
          placeholder="https://"
        />
      </Field>

      <Field
        label="Your audience"
        htmlFor="partner-audience"
        hint="Optional"
        help="Roughly how many people, and who they are."
      >
        <Input
          id="partner-audience"
          name="audience"
          maxLength={200}
          placeholder="e.g. 12k newsletter subscribers, mostly coaches"
        />
      </Field>

      <Field
        label="Anything else"
        htmlFor="partner-pitch"
        hint="Optional"
        help="How you plan to promote Sailo, if you'd like to tell us."
      >
        <Textarea id="partner-pitch" name="pitch" rows={3} maxLength={1000} />
      </Field>

      <Submit />

      <p className="text-xs leading-relaxed text-ink-500">
        You keep {share} of what every creator you refer pays Sailo, for as long
        as they stay. Referring yourself doesn&rsquo;t count, and paid ads
        bidding on our brand name aren&rsquo;t allowed.
      </p>
    </form>
  );
}
