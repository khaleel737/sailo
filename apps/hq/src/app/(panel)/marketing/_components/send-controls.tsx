"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, CalendarClock, Send, Trash2, X } from "lucide-react";
import { Alert, Button, Field, Input } from "@sailo/design-system/web";
import {
  deleteCampaignAction,
  scheduleCampaignAction,
  sendCampaignAction,
  unscheduleCampaignAction,
  type CampaignState,
} from "@/lib/actions/marketing";

/**
 * The three irreversible-ish things: send now, book a time, throw it away.
 *
 * Kept out of the composer deliberately. A form where the same region holds
 * both "save what I wrote" and "mail this to four thousand people" is a form
 * somebody eventually uses wrongly, and the cost of that mistake is not
 * symmetrical with the cost of an extra section on a page.
 */

function Pending({
  label,
  variant = "primary",
  icon,
}: {
  label: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  icon?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending}>
      {pending ? null : icon}
      {label}
    </Button>
  );
}

/**
 * Send now, gated on typing the word.
 *
 * A disabled button is a suggestion; a typed confirmation is a decision. The
 * same string is checked again in the action, because a disabled button is
 * also just an attribute on an element anybody can remove.
 */
export function SendNow({
  id,
  audienceSize,
}: {
  id: string;
  audienceSize: number;
}) {
  const [state, formAction] = useActionState<CampaignState, FormData>(
    sendCampaignAction,
    {},
  );
  const [typed, setTyped] = useState("");

  if (state.ok) {
    return (
      <Alert tone="success">
        Queued. The cron sends a batch every five minutes — this page shows the
        count as it goes.
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <p className="flex items-start gap-2 text-sm leading-relaxed text-ink-600">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
        <span>
          This goes to{" "}
          <strong className="tabular font-semibold text-ink-900">
            {audienceSize.toLocaleString()}
          </strong>{" "}
          people and cannot be unsent. Type <code className="font-mono">SEND</code>{" "}
          to confirm.
        </span>
      </p>

      <Field label="Confirm" htmlFor="confirm">
        <Input
          id="confirm"
          name="confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          // Never `required`: the field is the confirmation, and browser
          // validation on it would say "fill this in" rather than letting the
          // person read the sentence above it first.
          placeholder="SEND"
          className="max-w-40 font-mono uppercase"
        />
      </Field>

      <SendButton disabled={typed.trim().toUpperCase() !== "SEND"} />
    </form>
  );
}

function SendButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" loading={pending} disabled={disabled}>
      {pending ? null : <Send className="size-4" />}
      Send now
    </Button>
  );
}

/**
 * Book a time, or take the booking back.
 *
 * The hidden offset is what makes a `datetime-local` mean anything. That input
 * submits wall-clock time with no zone; the browser means it in the reader's
 * zone and `new Date()` on the server reads it in the server's. Sending the
 * offset alongside is what closes the gap — without it a campaign booked for
 * 09:00 in Lisbon goes out at 09:00 UTC, which is a different morning in half
 * the world.
 */
export function ScheduleControls({
  id,
  scheduledAt,
}: {
  id: string;
  /** ISO, or null. Pre-fills the field when a booking already exists. */
  scheduledAt: string | null;
}) {
  const [state, formAction] = useActionState<CampaignState, FormData>(
    scheduleCampaignAction,
    {},
  );
  const [undoState, undoAction] = useActionState<CampaignState, FormData>(
    unscheduleCampaignAction,
    {},
  );

  return (
    <div className="space-y-3">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {undoState.error ? <Alert tone="error">{undoState.error}</Alert> : null}

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={id} />
        {/*
          Read at submit time rather than at render, so a laptop that crossed a
          timezone (or a DST boundary) between page load and press books the
          time the person meant now.
        */}
        <OffsetField />
        <Field label="Send at" htmlFor="scheduledAt" className="min-w-56">
          <Input
            id="scheduledAt"
            name="scheduledAt"
            type="datetime-local"
            defaultValue={scheduledAt ?? ""}
            required
          />
        </Field>
        <Pending
          label={scheduledAt ? "Move it" : "Schedule"}
          variant="secondary"
          icon={<CalendarClock className="size-4" />}
        />
      </form>

      {scheduledAt ? (
        <form action={undoAction}>
          <input type="hidden" name="id" value={id} />
          <Pending
            label="Unschedule"
            variant="ghost"
            icon={<X className="size-4" />}
          />
        </form>
      ) : null}
    </div>
  );
}

/**
 * The reader's UTC offset, in minutes, as the server needs to add it.
 *
 * `getTimezoneOffset()` returns minutes to *add to local time to get UTC*,
 * which is the sign the action wants — so it is passed through unchanged
 * rather than negated somewhere in the middle where the next reader would have
 * to work out which convention won.
 *
 * Rendered as an uncontrolled field with no default so that a form submitted
 * before hydration sends nothing, and the action falls back to treating the
 * time as the server's. That is wrong by at most one timezone and is only
 * reachable in the window before this component's JavaScript runs.
 */
function OffsetField() {
  return (
    <input
      type="hidden"
      name="offsetMinutes"
      // A ref-free read at render: this component is a client component, so
      // this runs in the browser on the client render and the value is correct
      // by the time anything can be pressed.
      value={typeof window === "undefined" ? 0 : new Date().getTimezoneOffset()}
      readOnly
    />
  );
}

/** Deletes a draft. Never anything that has been sent — the action refuses. */
export function DeleteDraft({ id }: { id: string }) {
  const [state, formAction] = useActionState<CampaignState, FormData>(
    deleteCampaignAction,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Pending
        label="Delete draft"
        variant="ghost"
        icon={<Trash2 className="size-4" />}
      />
    </form>
  );
}
