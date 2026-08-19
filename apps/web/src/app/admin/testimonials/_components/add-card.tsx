"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card, Field, Input, Textarea } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { addTestimonial } from "@/lib/actions/testimonials";
import type { ActionState } from "@sailo/core/action-state";

const IDLE: ActionState = { ok: false };

/**
 * The seller typing one in.
 *
 * Approved on arrival, unlike a public submission — the seller is the
 * moderator, so asking them to approve their own typing is a click that means
 * nothing. The URL guards still apply: the danger is the value, not who
 * supplied it.
 */
export function AddCard() {
  const a = useAdminT();
  const [state, action] = useActionState(addTestimonial, IDLE);

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.testimonials.addTitle}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.testimonials.addBody}</p>
      </div>

      <form action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.testimonials.authorName} htmlFor="t-author">
            <Input id="t-author" name="authorName" required maxLength={80} />
          </Field>
          <Field label={a.testimonials.authorRole} htmlFor="t-role">
            <Input id="t-role" name="authorRole" maxLength={120} />
          </Field>
        </div>

        <Field label={a.testimonials.words} htmlFor="t-words">
          <Textarea id="t-words" name="body" rows={3} maxLength={1000} />
        </Field>

        <Field
          label={a.testimonials.videoUrl}
          htmlFor="t-video"
          hint={a.testimonials.videoUrlHint}
        >
          <Input id="t-video" name="videoUrl" type="url" placeholder="https://youtu.be/…" />
        </Field>

        <Field label={a.testimonials.avatarUrl} htmlFor="t-avatar">
          <Input id="t-avatar" name="avatarUrl" type="url" />
        </Field>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <Submit label={a.testimonials.add} />
      </form>
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
