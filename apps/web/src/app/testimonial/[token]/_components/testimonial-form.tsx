"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitTestimonialAction } from "@/lib/actions/testimonials";
import type { ActionState } from "@sailo/core/action-state";
import type { Dictionary } from "@sailo/i18n";

const IDLE: ActionState = { ok: false };

/**
 * The public submit form.
 *
 * No avatar upload in v1, and that is deliberate rather than unfinished: an
 * unauthenticated upload endpoint is a file store anybody can write to, and the
 * feature works without one — `author_avatar_url` is filled by the seller from
 * the moderation screen, where the uploader already exists behind a session.
 */
export function TestimonialForm({ token, t }: { token: string; t: Dictionary }) {
  const [state, action] = useActionState(submitTestimonialAction, IDLE);

  if (state.ok) {
    return (
      <div role="status" className="surface-elevated rounded-2xl p-5 text-sm font-medium">
        {t.testimonial.thanks}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />

      <Field id="t-name" label={t.checkout.yourName}>
        <input
          id="t-name"
          name="authorName"
          required
          maxLength={80}
          autoComplete="name"
          className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none"
        />
      </Field>

      <Field id="t-role" label={t.testimonial.yourRole} optional={t.common.optional}>
        <input
          id="t-role"
          name="authorRole"
          maxLength={120}
          className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none"
        />
      </Field>

      <Field id="t-body" label={t.testimonial.words}>
        <textarea
          id="t-body"
          name="body"
          rows={5}
          maxLength={1000}
          className="surface-elevated w-full rounded-xl px-3 py-2 text-sm outline-none"
        />
      </Field>

      <Field id="t-video" label={t.testimonial.video} optional={t.common.optional}>
        <input
          id="t-video"
          name="videoUrl"
          type="url"
          inputMode="url"
          placeholder="https://youtu.be/…"
          className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none"
        />
        <p className="text-muted mt-1 text-xs">{t.testimonial.videoHint}</p>
      </Field>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <Submit label={t.testimonial.send} busy={t.common.loading} />
      <p className="text-muted text-xs">{t.testimonial.moderated}</p>
    </form>
  );
}

function Field({
  id,
  label,
  optional,
  children,
}: {
  id: string;
  label: string;
  optional?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
        {optional ? (
          <span className="text-muted ml-1 text-xs font-normal">{optional}</span>
        ) : null}
      </label>
      {children}
    </div>
  );
}

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="press h-12 w-full rounded-xl bg-[var(--accent)] text-sm font-semibold text-[var(--accent-ink)] disabled:opacity-60"
    >
      {pending ? busy : label}
    </button>
  );
}
