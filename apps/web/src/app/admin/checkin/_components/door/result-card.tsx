"use client";

/**
 * What just happened to the last scan.
 *
 * The most time-critical thing on the screen: somebody is standing at a door waiting to be let
 * in, so the verdict has to be readable at arm's length and it has to say *why* a refusal is a
 * refusal — already admitted, wrong event, not paid, membership lapsed.
 *
 * Two credentials reach it now. A ticket is one admission and burns on use; a
 * member pass is durable and re-asks the subscription every time. They share
 * this card because a doorperson has one screen and one queue, and they share
 * the three colours — but they do **not** share the rule for which colour a
 * repeat scan earns. See `memberTone`.
 */

import { BadgeCheck, CircleAlert, TicketX } from "lucide-react";
import type { DoorVerdict } from "@sailo/commerce/ticketing";
import type { MemberCheckInState } from "@sailo/commerce/memberships/server";
import { interpolate } from "@sailo/i18n";
import { Card } from "@sailo/design-system/web";
import type { CheckinLabels } from "./labels";

type Tone = "good" | "warn" | "bad";

function shortDate(date: Date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function shortTime(date: Date) {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A member scanned twice is green, where a ticket scanned twice is amber.
 *
 * The single most important line in this file. `already_used` on a ticket
 * means somebody is trying to get a second person in on one admission and the
 * volunteer must stop. `already_in` on a membership means the member scanned,
 * the screen lagged, and they scanned again — they are paid up and standing
 * there, and an amber screen would have a volunteer turn them away. Same
 * word, opposite instruction.
 */
function memberTone(state: MemberCheckInState): Tone {
  if (state.status === "checked_in" || state.status === "already_in") return "good";
  return "bad";
}

function memberHeadline(state: MemberCheckInState, a: CheckinLabels): string {
  switch (state.status) {
    case "checked_in":
      return a.memberIn;
    case "already_in":
      return a.memberAlreadyIn;
    case "wrong_membership":
      return state.productTitle
        ? interpolate(a.memberWrong, { membership: state.productTitle })
        : a.memberWrongUnknown;
    case "not_open":
      /*
       * "They owe us for this period" and "they stopped paying months ago" are
       * different conversations at a door, and only the first one ends with
       * the member being let in while somebody checks. A manual rail is the
       * only place the distinction exists — a card renewal is charged rather
       * than asked for.
       */
      if (state.awaitingPayment) return a.memberAwaitingPayment;
      return state.until
        ? interpolate(a.memberLapsedOn, { date: shortDate(state.until) })
        : a.memberLapsed;
    default:
      return a.notFound;
  }
}

/**
 * The line under the headline: who they are, and the history that tells a
 * doorperson whether to wave them through or call someone.
 */
function memberDetail(state: MemberCheckInState, a: CheckinLabels): string | null {
  if (state.status === "wrong_membership" || state.status === "not_found") {
    return null;
  }

  const parts: string[] = [];
  if (state.memberName) parts.push(state.memberName);
  if (state.productTitle) parts.push(state.productTitle);

  if (state.status === "not_open") {
    return parts.join(" · ") || null;
  }

  if (state.endingSoon && state.until) {
    parts.push(interpolate(a.memberEndingSoon, { date: shortDate(state.until) }));
  } else if (state.until) {
    parts.push(interpolate(a.memberPaidUntil, { date: shortDate(state.until) }));
  }

  parts.push(
    state.lastVisitAt
      ? interpolate(a.memberLastVisit, { when: shortTime(state.lastVisitAt) })
      : a.memberFirstVisit,
  );
  if (state.visitCount > 1) {
    parts.push(interpolate(a.memberVisits, { count: String(state.visitCount) }));
  }

  return parts.join(" · ");
}

/**
 * Big type and hard colour, because this is read at arm's length in a doorway
 * by somebody who is also watching a queue. The three outcomes are green,
 * amber and red and never share a shape.
 */
export function ResultCard({
  verdict,
  labels: a,
}: {
  verdict: DoorVerdict | null;
  labels: CheckinLabels;
}) {
  if (!verdict) return null;

  if (verdict.kind === "member") {
    const state = verdict.result;
    const tone = memberTone(state);
    return (
      <Shell
        tone={tone}
        headline={memberHeadline(state, a)}
        detail={memberDetail(state, a)}
        code={"code" in state ? state.code : null}
        badge={a.memberPass}
      />
    );
  }

  const state = verdict.result;
  if (state.status === "idle") return null;

  const tone: Tone =
    state.status === "checked_in"
      ? "good"
      : state.status === "already_used"
        ? "warn"
        : "bad";

  const headline =
    state.status === "checked_in"
      ? a.checkedIn
      : state.status === "already_used"
        ? state.usedAt
          ? interpolate(a.alreadyUsedAt, { time: shortTime(state.usedAt) })
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

  const detail =
    "attendee" in state
      ? [
          [state.attendee, state.tier].filter(Boolean).join(" · "),
          state.checkedInBy
            ? interpolate(a.byWhom, { name: state.checkedInBy })
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : null;

  return (
    <Shell
      tone={tone}
      headline={headline}
      detail={detail}
      code={"code" in state && state.code ? state.code : null}
      badge={null}
    />
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The card itself, shared so the two credentials cannot drift into looking
 * like different screens — a volunteer switching between a gig and a gym
 * should be reading the same shape in the same place.
 */
function Shell({
  tone,
  headline,
  detail,
  code,
  badge,
}: {
  tone: Tone;
  headline: string;
  detail: string | null;
  code: string | null;
  badge: string | null;
}) {
  return (
    <Card
      aria-live="assertive"
      className={`animate-fade p-5 ${
        tone === "good"
          ? "border-emerald-300 bg-emerald-50"
          : tone === "warn"
            ? "border-amber-300 bg-amber-50"
            : "border-red-300 bg-red-50"
      }`}
    >
      <div className="flex items-start gap-3">
        {tone === "good" ? (
          <BadgeCheck className="mt-0.5 size-9 shrink-0 text-emerald-600" />
        ) : tone === "warn" ? (
          <CircleAlert className="mt-0.5 size-9 shrink-0 text-amber-600" />
        ) : (
          <TicketX className="mt-0.5 size-9 shrink-0 text-red-600" />
        )}
        <div className="min-w-0">
          <p
            className={`text-lg font-bold ${
              tone === "good"
                ? "text-emerald-900"
                : tone === "warn"
                  ? "text-amber-900"
                  : "text-red-900"
            }`}
          >
            {headline}
          </p>
          {badge ? (
            <span className="mt-1 inline-flex rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium text-ink-600">
              {badge}
            </span>
          ) : null}
          {detail ? (
            <p className="mt-1 truncate text-sm text-ink-700">{detail}</p>
          ) : null}
          {code ? (
            <p className="mt-0.5 font-mono text-xs text-ink-500">{code}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
