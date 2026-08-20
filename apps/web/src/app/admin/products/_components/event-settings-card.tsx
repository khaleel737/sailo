"use client";

import { useState } from "react";
import { Card, Field, Input, Select, Textarea } from "@sailo/design-system/web";
import { Toggle } from "./toggle";
import { EventSessionEditor } from "./event-session-editor";
import { EventTierEditor } from "./event-tier-editor";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { EventSession, EventTier } from "@sailo/db/schema";
import type { ProductWithRelations } from "./product.types";

/** When the event happens, where to turn up, and when tickets unlock. */

/** A Date as `datetime-local` wants it: local wall clock, minute precision. */
function toLocalInput(date: Date | null | undefined): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function EventSettingsCard({
  product,
  releaseOnPayment,
  onReleaseOnPaymentChange,
  timeZone,
  currency,
  tiers = [],
  sessions = [],
  eventTiers = false,
  eventSessions = false,
  basePrice = "",
}: {
  product?: ProductWithRelations;
  releaseOnPayment: boolean;
  onReleaseOnPaymentChange: (next: boolean) => void;
  /** The shop's own zone, named so "19:00" means a particular 19:00. */
  timeZone: string;
  /** The shop's currency, for the price a band is typed in. */
  currency: string;
  /** The bands this event already has — spec 50. Empty on a new product. */
  tiers?: EventTier[];
  /** The dates it already runs on — spec 50. */
  sessions?: EventSession[];
  /**
   * Whether the plan includes price bands, and whether it includes several
   * dates — spec 50. Two flags because they are two plans: tiers are Pro and
   * sessions are Business.
   *
   * Decided here *and* in `saveProduct`, like every other gate on this form: a
   * form is not a gate, and a hand-rolled POST does not render this card. Both
   * fall back rather than refusing — a downgraded shop keeps its bands and its
   * dates in the table and simply stops editing them, because a refusal would
   * leave a seller unable to change a title.
   */
  eventTiers?: boolean;
  eventSessions?: boolean;
  /** The product's own price, shown as the placeholder a band inherits. */
  basePrice?: string;
}) {
  const a = useAdminT();
  const [collectAttendees, setCollectAttendees] = useState(
    () => product?.collectAttendeeDetails ?? false,
  );
  const [allowSelfCancel, setAllowSelfCancel] = useState(
    () => product?.eventAllowSelfCancel ?? false,
  );
  /*
   * Which fields are even relevant is decided here rather than by a seller
   * reading labels: an online event has a join link and no venue, a room has
   * a venue and no link. Showing both invites a seller to fill in both, and
   * the product then has an address the buyer's email will never print.
   *
   * Three modes, not two. `eventMode` has been a column, a `ProductInput`
   * field and a `formData.get` since spec 50 landed, and nothing ever posted
   * it — so it saved as null on every event and "both" was unreachable. The
   * publish check reads it (`event_needs_venue` / `event_needs_join_url`) and
   * was falling back to `serviceMode`, which cannot express a hybrid: a room
   * that also streams was refused a join link or refused a venue, whichever
   * the seller picked.
   */
  const [mode, setMode] = useState<string>(
    () => product?.eventMode ?? (product?.serviceMode === "online" ? "online" : "in_person"),
  );
  const online = mode !== "in_person";
  const inPerson = mode !== "online";

  /*
   * Held in state only so the end can refuse to offer a moment before the
   * start. The server refuses it too — this is the version the seller meets
   * while they are still looking at the field, not the one that costs them a
   * round trip.
   */
  const [startsAt, setStartsAt] = useState(() => toLocalInput(product?.eventStartsAt));

  /*
   * How a buyer meets the dates — spec 50. Blank is a single date, which is
   * every event today and deliberately not a third named value: a mode that had
   * to be written to every existing row is what `sessionMode`'s own nullability
   * exists to avoid.
   *
   * Held in state because the list below is only worth showing once the answer
   * is "several".
   */
  const [sessionMode, setSessionMode] = useState(() => product?.sessionMode ?? "");
  const severalDates = sessionMode !== "";

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.productForm.eventTitle}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.productForm.eventBody}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={a.productForm.eventStartsAt}
          htmlFor="eventStartsAt"
          /* The shop's zone, named rather than assumed. "19:00" is not a
             moment until somebody says whose seven in the evening it is. */
          hint={timeZone}
          help={a.productForm.eventStartsAtHint}
        >
          <Input
            id="eventStartsAt"
            name="eventStartsAt"
            type="datetime-local"
            required
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </Field>

        {/*
          Optional, and it gates nothing — sales still close when the doors
          open. What it buys is a buyer's page that can say "19:00 – 22:00",
          which is the difference between an event somebody can plan an evening
          around and one they cannot.

          `min` is the start rather than a validation message, so the picker
          simply does not offer a moment before it.
        */}
        <Field
          label={a.productForm.eventEndsAt}
          htmlFor="eventEndsAt"
          hint={a.common.optional}
          help={a.productForm.eventEndsAtHint}
        >
          <Input
            id="eventEndsAt"
            name="eventEndsAt"
            type="datetime-local"
            min={startsAt || undefined}
            defaultValue={toLocalInput(product?.eventEndsAt)}
          />
        </Field>
      </div>

      <Field label={a.productForm.eventMode} htmlFor="eventMode">
        <Select
          id="eventMode"
          name="eventMode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="sm:w-64"
        >
          <option value="in_person">{a.productForm.eventModeInPerson}</option>
          <option value="online">{a.productForm.eventModeOnline}</option>
          <option value="hybrid">{a.productForm.eventModeHybrid}</option>
        </Select>
      </Field>

      {/*
        `serviceMode` is still posted, because it is what the *buyer* reads:
        the shop card and the product page both print "Online" or "In person"
        off it, and an order line keeps a copy. A hybrid has somewhere to turn
        up, so it reads as in person there — the join link is shown alongside
        it, and calling a room with a stream "online" would send people to a
        page instead of an address.
      */}
      <input
        type="hidden"
        name="serviceMode"
        value={mode === "online" ? "online" : "in_person"}
      />

      {online ? (
        <Field
          label={a.productForm.eventJoinUrl}
          htmlFor="eventJoinUrl"
          hint={a.productForm.eventJoinUrlHint}
        >
          <Input
            id="eventJoinUrl"
            name="eventJoinUrl"
            type="url"
            inputMode="url"
            maxLength={2000}
            defaultValue={product?.eventJoinUrl ?? ""}
            placeholder="https://zoom.us/j/…"
          />
        </Field>
      ) : null}

      {inPerson ? (
        <Field
          label={a.productForm.eventVenue}
          htmlFor="serviceLocation"
          hint={a.productForm.serviceLocationHint}
        >
          <Input
            id="serviceLocation"
            name="serviceLocation"
            maxLength={500}
            defaultValue={product?.serviceLocation ?? ""}
            placeholder={a.productForm.eventVenuePlaceholder}
          />
        </Field>
      ) : null}

      <Toggle
        name="releaseOnPayment"
        label={a.productForm.eventReleaseOnPayment}
        description={a.productForm.eventReleaseOnPaymentBody}
        checked={releaseOnPayment}
        onChange={onReleaseOnPaymentChange}
      />

      <p className="text-xs text-ink-500">{a.productForm.eventCapacityHint}</p>

      {/*
        Several dates on one event — spec 50, Business.
        Above the bands because it is the wider question: a seller decides
        whether this is one night or eight before they decide what a seat in the
        room costs.
      */}
      {eventSessions ? (
        <div className="space-y-4 border-t border-black/5 pt-4">
          <h3 className="text-[13px] font-medium text-ink-800">
            {a.productForm.sessionsTitle}
          </h3>

          {/*
            Named by the heading above it rather than by a label beside it. The
            dictionary gives `sessionsTitle` and `sessionMode` the same word —
            "Dates" — because they are the same subject, and printing it twice
            in two type sizes reads as a bug. The `aria-label` keeps the control
            named for anybody who is not looking at the heading.
          */}
          <Select
            id="sessionMode"
            name="sessionMode"
            aria-label={a.productForm.sessionMode}
            value={sessionMode}
            onChange={(e) => setSessionMode(e.target.value)}
            className="sm:w-96"
          >
            {/* Blank, not "single" — `isSessionMode` refuses anything that is
                not one of the two, and null is what the column already holds
                on every event ever saved. */}
            <option value="">{a.productForm.sessionModeSingle}</option>
            <option value="pick_one">{a.productForm.sessionModePickOne}</option>
            <option value="all_access">
              {a.productForm.sessionModeAllAccess}
            </option>
          </Select>

          <EventSessionEditor
            sessions={sessions}
            visible={severalDates}
            eventStartsAt={startsAt}
          />
        </div>
      ) : null}

      {/*
        Early bird, General, VIP against one room — spec 50, Pro.

        Not variants, and the schema note over `eventTiers` says why at length:
        a tier forced into `products.options` becomes a fake option group that
        renders in the buyer's picker and appears in every variant matrix.
      */}
      {eventTiers ? (
        <div className="space-y-4 border-t border-black/5 pt-4">
          <div>
            <h3 className="text-[13px] font-medium text-ink-800">
              {a.productForm.tiersTitle}
            </h3>
            <p className="mt-0.5 text-xs text-ink-500">{a.productForm.tiersBody}</p>
          </div>

          <EventTierEditor
            tiers={tiers}
            currency={currency}
            basePrice={basePrice}
          />
        </div>
      ) : null}

      {/*
        Venue, zone and policy — spec 50. None of it is plan-gated: a buyer's
        calendar entry being in the wrong timezone is correctness rather than
        upsell, and a refund policy nobody was shown is a dispute lost.
      */}
      <div className="space-y-4 border-t border-black/5 pt-4">
        <h3 className="text-[13px] font-medium text-ink-800">
          {a.productForm.eventVenueTitle}
        </h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.productForm.eventVenueName} htmlFor="eventVenueName">
            <Input
              id="eventVenueName"
              name="eventVenueName"
              maxLength={200}
              defaultValue={product?.eventVenueName ?? ""}
            />
          </Field>
          <Field
            label={a.productForm.eventTimeZone}
            htmlFor="eventTimeZone"
            help={a.productForm.eventTimeZoneHint}
          >
            <Input
              id="eventTimeZone"
              name="eventTimeZone"
              maxLength={64}
              defaultValue={product?.eventTimeZone ?? ""}
              placeholder="Europe/London"
            />
          </Field>
        </div>

        <Field label={a.productForm.eventAddress} htmlFor="eventAddress">
          <Textarea
            id="eventAddress"
            name="eventAddress"
            rows={2}
            maxLength={500}
            defaultValue={product?.eventAddress ?? ""}
          />
        </Field>

        <Toggle
          name="collectAttendeeDetails"
          label={a.productForm.collectAttendeeDetails}
          description={a.productForm.collectAttendeeDetailsHint}
          checked={collectAttendees}
          onChange={setCollectAttendees}
        />
      </div>

      <div className="space-y-4 border-t border-black/5 pt-4">
        <Field
          label={a.productForm.eventRefundPolicy}
          htmlFor="eventRefundPolicy"
          help={a.productForm.eventRefundPolicyHint}
        >
          <Textarea
            id="eventRefundPolicy"
            name="eventRefundPolicy"
            rows={3}
            maxLength={2000}
            defaultValue={product?.eventRefundPolicy ?? ""}
          />
        </Field>

        <Field
          label={a.productForm.eventRefundCutoff}
          htmlFor="eventRefundCutoffHours"
        >
          <Input
            id="eventRefundCutoffHours"
            name="eventRefundCutoffHours"
            inputMode="numeric"
            defaultValue={product?.eventRefundCutoffHours ?? ""}
            placeholder="48"
            className="sm:w-32"
          />
        </Field>

        <Toggle
          name="eventAllowSelfCancel"
          label={a.productForm.eventAllowSelfCancel}
          description={a.productForm.eventAllowSelfCancelHint}
          checked={allowSelfCancel}
          onChange={setAllowSelfCancel}
        />
      </div>
    </Card>
  );
}
