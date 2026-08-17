"use client";

/**
 * What just happened to the last scan.
 *
 * The most time-critical thing on the screen: somebody is standing at a door waiting to be let
 * in, so the verdict has to be readable at arm's length and it has to say *why* a refusal is a
 * refusal — already admitted, wrong event, not paid.
 */

import { BadgeCheck, CircleAlert, TicketX } from "lucide-react";
import type { CheckInState } from "@sailo/commerce/ticketing";
import { interpolate } from "@sailo/i18n";
import { Card } from "@sailo/design-system/web";
import type { CheckinLabels } from "./labels";

/* -------------------------------------------------------------------------- */
/*  The answer                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Big type and hard colour, because this is read at arm's length in a doorway
 * by somebody who is also watching a queue. The three outcomes are green,
 * amber and red and never share a shape.
 */
export function ResultCard({
  state,
  labels: a,
}: {
  state: CheckInState;
  labels: CheckinLabels;
}) {
  if (state.status === "idle") return null;

  const good = state.status === "checked_in";
  const warn = state.status === "already_used";

  const headline = good
    ? a.checkedIn
    : warn
      ? state.usedAt
        ? interpolate(a.alreadyUsedAt, {
            time: state.usedAt.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            }),
          })
        : a.alreadyUsed
      : state.status === "wrong_event"
        ? state.productTitle
          ? interpolate(a.wrongEvent, { event: state.productTitle })
          : a.wrongEventUnknown
        : state.status === "revoked"
          ? a.revoked
          : state.status === "not_released"
            ? a.notReleased
            : a.notFound;

  return (
    <Card
      aria-live="assertive"
      className={`animate-fade p-5 ${
        good
          ? "border-emerald-300 bg-emerald-50"
          : warn
            ? "border-amber-300 bg-amber-50"
            : "border-red-300 bg-red-50"
      }`}
    >
      <div className="flex items-start gap-3">
        {good ? (
          <BadgeCheck className="mt-0.5 size-9 shrink-0 text-emerald-600" />
        ) : warn ? (
          <CircleAlert className="mt-0.5 size-9 shrink-0 text-amber-600" />
        ) : (
          <TicketX className="mt-0.5 size-9 shrink-0 text-red-600" />
        )}
        <div className="min-w-0">
          <p
            className={`text-lg font-bold ${
              good
                ? "text-emerald-900"
                : warn
                  ? "text-amber-900"
                  : "text-red-900"
            }`}
          >
            {headline}
          </p>
          {"attendee" in state ? (
            <p className="mt-1 truncate text-sm text-ink-700">
              {[state.attendee, state.tier].filter(Boolean).join(" · ")}
              {state.checkedInBy ? (
                <span className="text-ink-500">
                  {" "}
                  {interpolate(a.byWhom, { name: state.checkedInBy })}
                </span>
              ) : null}
              <span className="mt-0.5 block font-mono text-xs text-ink-500">
                {state.code}
              </span>
            </p>
          ) : "code" in state && state.code ? (
            <p className="mt-1 font-mono text-xs text-ink-500">{state.code}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
