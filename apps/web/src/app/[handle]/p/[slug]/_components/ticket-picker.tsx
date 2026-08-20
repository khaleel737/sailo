"use client";

import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
import { formatMoney } from "@sailo/core/currency";
import type { BuySession, BuyTier } from "@sailo/core/catalog";

/**
 * Which ticket, and for which date — spec 50.
 *
 * The seller's half of this shipped with the tier and session editors; this is
 * the control that makes any of it reachable. Until it existed a buyer saw the
 * product's price, paid the product's price, and no seat moved against the band
 * the seller thought they were selling.
 *
 * TWO CONTROLS, TWO SHAPES, AND THAT IS DELIBERATE
 *
 * Bands are chips, like every other choice on this page: there are two or three
 * of them, each carries a price the buyer is comparing, and a row of prices is
 * the whole decision. Dates are a `<select>`, because "repeat weekly" writes up
 * to fifty-two of them and fifty-two chips is not a choice, it is a wall.
 *
 * SOLD OUT IS VISIBLE, NOT MISSING
 *
 * A band that has gone stays on screen, struck through and unpressable. A buyer
 * who came for VIP has to be able to see that VIP is what has gone — removing
 * the row makes them wonder whether they mis-read the page, and makes the
 * seller believe their tier disappeared. Same rule the option chips already
 * follow one component over.
 */
export function TicketPicker({
  tiers,
  sessions,
  tierId,
  sessionId,
  currency,
  locale,
  onTier,
  onSession,
  t,
}: {
  tiers: BuyTier[];
  sessions: BuySession[];
  tierId: string | null;
  sessionId: string | null;
  currency: string;
  locale?: string;
  onTier: (id: string) => void;
  onSession: (id: string) => void;
  t: Dictionary;
}) {
  return (
    <>
      {tiers.length > 0 ? (
        <fieldset>
          <legend id="ticket-tier" className="mb-1.5 text-sm font-medium">
            {t.shop.ticketType}
          </legend>
          <div
            role="radiogroup"
            aria-labelledby="ticket-tier"
            onKeyDown={onKeyDown}
            // Focusable as a composite widget; the radios inside carry the
            // roving 0/-1 tabindex, so this stays out of the tab order.
            tabIndex={-1}
            className="flex flex-col gap-1.5"
          >
            {tiers.map((tier) => {
              const active = tier.id === tierId;
              return (
                <button
                  key={tier.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={tier.soldOut}
                  onClick={() => onTier(tier.id)}
                  /*
                   * One tab stop for the group. The chosen band, or the first
                   * one that can still be had — a group with no tab stop at all
                   * is a question a keyboard cannot answer.
                   */
                  tabIndex={
                    tier.id === (tierId ?? tiers.find((row) => !row.soldOut)?.id)
                      ? 0
                      : -1
                  }
                  /* 44px on a coarse pointer. This control picks what is being
                     bought and what it costs; a miss lands on the neighbouring
                     band, which is somebody paying a different price. */
                  className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-start text-sm transition pointer-coarse:min-h-11 ${
                    active ? "accent-bg" : "surface-elevated hover:opacity-70"
                  } ${tier.soldOut ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  <span className="min-w-0">
                    <span
                      className={`block font-medium ${tier.soldOut ? "line-through" : ""}`}
                    >
                      {tier.name}
                    </span>
                    {tier.description ? (
                      <span className="text-muted block text-xs leading-snug">
                        {tier.description}
                      </span>
                    ) : null}
                    {/*
                      "Only 3 left" on the band rather than on the room — spec
                      50. A room of two hundred with four VIP seats left is not
                      scarce and the buyer choosing VIP is looking at the wrong
                      number if it says so.
                    */}
                    {!tier.soldOut && tier.seatsLeft !== null && tier.seatsLeft <= 5 ? (
                      <span className="block text-xs font-medium text-amber-600">
                        {interpolate(t.checkout.onlyLeft, { count: tier.seatsLeft })}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {tier.soldOut
                      ? t.shop.soldOut
                      : tier.priceCents > 0
                        ? formatMoney(tier.priceCents, currency, locale)
                        : t.common.free}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {sessions.length > 0 ? (
        <div>
          <label
            htmlFor="ticket-session"
            className="mb-1.5 block text-sm font-medium"
          >
            {t.shop.chooseDate}
          </label>
          <select
            id="ticket-session"
            value={sessionId ?? ""}
            onChange={(event) => onSession(event.target.value)}
            className="surface-elevated h-11 w-full rounded-xl px-3 text-sm"
          >
            {/*
              An empty first option only while nothing is chosen. The page opens
              on the soonest date that can still be had, so this is reachable
              only when every date has gone or been cancelled — and a select
              that silently pre-picked a cancelled date would be worse than one
              the buyer has to answer.
            */}
            {sessionId === null ? (
              <option value="">{t.shop.chooseDate}</option>
            ) : null}
            {sessions.map((session) => (
              <option
                key={session.id}
                value={session.id}
                disabled={session.cancelled || session.soldOut}
              >
                {sessionLabel(session, locale, t)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </>
  );
}

/**
 * One date as a buyer reads it, with why they cannot have it when they cannot.
 *
 * The reason is in the option's own text rather than only in its `disabled`
 * state, because a greyed-out row in a native select says nothing at all —
 * and "cancelled" and "sold out" are two different things to be told about a
 * date somebody may already hold a ticket for.
 */
function sessionLabel(session: BuySession, locale: string | undefined, t: Dictionary) {
  const when = session.startsAt.toLocaleString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  if (session.cancelled) return `${when} — ${t.shop.dateCancelled}`;
  if (session.soldOut) return `${when} — ${t.shop.soldOut}`;
  if (session.seatsLeft !== null && session.seatsLeft <= 5) {
    return `${when} — ${interpolate(t.checkout.onlyLeft, { count: session.seatsLeft })}`;
  }
  return when;
}

/**
 * Arrow keys walk the bands and choose as they go — a native radio group's
 * behaviour, which is what a buyer's hands already expect. Sold-out bands are
 * skipped rather than landed on.
 *
 * Lifted from `OptionChips` rather than shared with it: that component is
 * driven by `products.options` and a variant matrix, and threading a second
 * unrelated data shape through it to reuse twenty lines of key handling would
 * make both harder to read than either is now.
 */
function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  const horizontal = event.key === "ArrowRight" || event.key === "ArrowLeft";
  const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
  if (!horizontal && !vertical) return;

  const group = event.currentTarget;
  const chips = Array.from(
    group.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
  );
  if (chips.length === 0) return;

  // "Next" is a direction on screen, not a key name: in an Arabic storefront
  // the right arrow has to walk backwards to keep moving the way the buyer
  // sees it. The vertical pair never flips.
  const rtl = getComputedStyle(group).direction === "rtl";
  const forward = vertical
    ? event.key === "ArrowDown"
    : (event.key === "ArrowRight") !== rtl;

  const current = chips.indexOf(document.activeElement as HTMLButtonElement);
  const step = forward ? 1 : -1;
  // `current` is -1 when focus is elsewhere, which lands on the first chip.
  const next = chips[(current + step + chips.length) % chips.length];
  if (!next) return;

  event.preventDefault();
  next.focus();
  next.click();
}
