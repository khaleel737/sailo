"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@sailo/design-system/web";
import type { ActionState } from "@sailo/core/action-state";
import { RISK_SEVERITIES } from "@sailo/core/risk";
import { clearRiskFlag, raiseRiskFlag } from "@/lib/actions/risk";

const IDLE: ActionState = { ok: false };

function Submit({
  children,
  variant = "secondary",
}: {
  children: string;
  variant?: "secondary" | "danger" | "primary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} loading={pending}>
      {children}
    </Button>
  );
}

function Feedback({ state }: { state: ActionState }) {
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  if (!state.ok && state.error) return <Alert tone="error">{state.error}</Alert>;
  return null;
}

/**
 * Putting a shop on the desk by hand.
 *
 * The severity is a required choice with no default, deliberately. A
 * pre-selected `watch` is the option nobody changes, and a queue where
 * everything is a watch is a queue with no order to work it in.
 */
export function RaiseFlag({ shopId }: { shopId: string }) {
  const [state, action] = useActionState(raiseRiskFlag, IDLE);

  return (
    <Card className="p-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="shopId" value={shopId} />
        {/* `manual` is the only kind a human raises — see the vocabulary. */}
        <input type="hidden" name="kind" value="manual" />

        <h3 className="text-sm font-semibold text-ink-900">Flag this shop</h3>
        <p className="text-xs leading-relaxed text-ink-500">
          Puts it on the risk desk for everybody, until somebody clears it with a
          reason. The desk raises its own findings from the numbers — this is for
          what the numbers cannot see.
        </p>

        <Feedback state={state} />

        <Field label="How loud" htmlFor={`sev-${shopId}`}>
          <Select id={`sev-${shopId}`} name="severity" defaultValue="" required>
            <option value="" disabled>
              Choose…
            </option>
            {RISK_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s === "watch"
                  ? "Watch — keep an eye on it"
                  : s === "review"
                    ? "Review — somebody read this today"
                    : "Act — do something now"}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="What you saw" htmlFor={`sum-${shopId}`}>
          <Textarea
            id={`sum-${shopId}`}
            name="summary"
            rows={3}
            required
            maxLength={500}
            placeholder="Three buyers have written in saying the same thing…"
          />
        </Field>

        <Field label="Reference" htmlFor={`ev-${shopId}`} hint="Optional — a ticket, an order id.">
          <Input id={`ev-${shopId}`} name="evidence" maxLength={120} autoComplete="off" />
        </Field>

        <Submit variant="danger">Flag</Submit>
      </form>
    </Card>
  );
}

/**
 * Taking one off, which needs a sentence.
 *
 * The reason field opens on click rather than sitting there: a textarea beside
 * every row turns the desk into a wall of empty boxes, and the point of asking
 * is that somebody stops and types rather than clears on the way past.
 */
export function ClearFlag({ flagId }: { flagId: string }) {
  const [state, action] = useActionState(clearRiskFlag, IDLE);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Clear
      </Button>
    );
  }

  return (
    <form action={action} className="w-full space-y-2">
      <input type="hidden" name="flagId" value={flagId} />
      <Feedback state={state} />
      <Input
        name="reason"
        required
        maxLength={500}
        autoFocus
        placeholder="Why is this not a problem?"
        aria-label="Why this is being cleared"
      />
      <div className="flex gap-2">
        <Submit>Clear it</Submit>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
