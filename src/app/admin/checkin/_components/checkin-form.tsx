"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { BadgeCheck, CircleAlert, Loader2, TicketX } from "lucide-react";
import { checkInTicket } from "@/lib/actions/tickets";
import type { CheckInState } from "@/lib/tickets";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@/i18n";
import { Button, Card, Field, Input } from "@/components/ui";

function Submit() {
  const a = useAdminT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {a.checkin.submit}
    </Button>
  );
}

/**
 * One field, one button, one loud answer. Big type and hard colours on
 * purpose: this is read at arm's length in a doorway, not at a desk.
 */
export function CheckinForm({ initialCode }: { initialCode: string }) {
  const a = useAdminT();
  const [state, action] = useActionState<CheckInState, FormData>(checkInTicket, {
    status: "idle",
  });

  return (
    <div className="max-w-md space-y-4">
      <Card className="p-5">
        <form action={action} className="space-y-4">
          <Field
            label={a.checkin.codeLabel}
            htmlFor="code"
            hint={a.checkin.scanHint}
          >
            <Input
              id="code"
              name="code"
              required
              autoFocus
              autoComplete="off"
              defaultValue={initialCode}
              placeholder="ABC12-DE345"
              className="font-mono uppercase"
            />
          </Field>
          <Submit />
        </form>
      </Card>

      {state.status !== "idle" ? (
        <Card
          className={`p-5 ${
            state.status === "checked_in"
              ? "border-green-300 bg-green-50"
              : state.status === "already_used"
                ? "border-amber-300 bg-amber-50"
                : "border-red-300 bg-red-50"
          }`}
        >
          {state.status === "checked_in" ? (
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-0.5 size-8 shrink-0 text-green-600" />
              <div>
                <p className="text-lg font-bold text-green-900">
                  {a.checkin.checkedIn}
                </p>
                <ResultDetails state={state} />
              </div>
            </div>
          ) : state.status === "already_used" ? (
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 size-8 shrink-0 text-amber-600" />
              <div>
                <p className="text-lg font-bold text-amber-900">
                  {state.usedAt
                    ? interpolate(a.checkin.alreadyUsedAt, {
                        time: state.usedAt.toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        }),
                      })
                    : a.checkin.alreadyUsed}
                </p>
                <ResultDetails state={state} />
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <TicketX className="mt-0.5 size-8 shrink-0 text-red-600" />
              <p className="text-lg font-bold text-red-900">
                {state.status === "not_released"
                  ? a.checkin.notReleased
                  : a.checkin.notFound}
              </p>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function ResultDetails({
  state,
}: {
  state: Extract<CheckInState, { status: "checked_in" | "already_used" }>;
}) {
  return (
    <p className="mt-1 text-sm text-ink-700">
      {[state.buyer, state.productTitle].filter(Boolean).join(" — ")}
      <span className="mt-0.5 block font-mono text-xs text-ink-500">
        {state.code}
      </span>
    </p>
  );
}
