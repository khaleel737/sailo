"use client";

import { startTransition, useActionState, useState } from "react";
import { CalendarCheck } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Switch,
} from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { PlanBadge } from "@/app/admin/_components/locked-feature";
import {
  WeeklyHoursField,
  zoneChoices,
} from "@/app/admin/_components/weekly-hours-field";
import { saveStaffMember, toggleStaffActive } from "@/lib/actions/staff";
import { interpolate } from "@sailo/i18n";
import type { ActionState } from "@sailo/core/action-state";
import type { WeeklyHours } from "@sailo/db/schema";

/**
 * The roster — who a buyer can book, and on what hours.
 *
 * WHY THE CALENDAR ADDRESS IS NOT IN THESE PROPS
 *
 * `RosterPerson` is the staff row with the feed URL taken out and replaced by
 * its hostname. That link is a bearer token for somebody's whole calendar, and
 * this is a client component — anything in its props is in the RSC payload and
 * therefore in the page source. The card shows *that* there is a calendar and
 * where it lives; it never holds the link. Which is also why a blank field
 * means "leave it alone" and disconnecting is its own checkbox: the shop's own
 * feed is read exactly this way, for exactly this reason.
 */
export type RosterPerson = {
  id: string;
  name: string;
  email: string | null;
  hours: WeeklyHours | null;
  timeZone: string | null;
  isActive: boolean;
  /** The host of their feed, or null when they have not connected one. */
  feedHost: string | null;
};

const IDLE: ActionState = { ok: false };

export function StaffCard({
  roster,
  shopHours,
  shopTimeZone,
  unlocked,
}: {
  roster: RosterPerson[];
  /** Seeds a new person's editor, since blank means "the shop's hours". */
  shopHours: WeeklyHours;
  shopTimeZone: string;
  /** Whether the plan includes staff and classes — spec 51. */
  unlocked: boolean;
}) {
  const a = useAdminT();

  return (
    <Card className="space-y-5 p-5">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-900">
            {a.productForm.staffTitle}
          </h2>
          {unlocked ? null : <PlanBadge feature="staffResources" />}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
          {a.productForm.staffBody}
        </p>
      </div>

      {roster.length > 0 ? (
        <ul className="divide-y divide-ink-100">
          {roster.map((person) => (
            <li key={person.id} className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">
                    {person.name}
                  </span>
                  {person.email ? (
                    <span className="block truncate text-xs text-ink-500">
                      {person.email}
                    </span>
                  ) : null}
                </span>

                {person.feedHost ? (
                  <span className="inline-flex items-center gap-1 text-xs text-ink-500">
                    <CalendarCheck className="size-3.5" />
                    {person.feedHost}
                  </span>
                ) : null}

                {/*
                  A switch and not a checkbox, because it takes effect on its
                  own — and it stays live on every plan. A shop that downgrades
                  must be able to stop offering somebody; the alternative is a
                  seller who cannot turn off a calendar they no longer pay for.
                */}
                <form action={toggleStaffActive}>
                  <input type="hidden" name="staffId" value={person.id} />
                  <Switch
                    name="active"
                    defaultChecked={person.isActive}
                    label={a.productForm.staffActive}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  />
                </form>
              </div>

              <details className="mt-2">
                <summary className="focus-ring inline-block cursor-pointer rounded-lg px-1 text-xs font-medium text-ink-600 hover:text-ink-900 pointer-coarse:min-h-11 pointer-coarse:py-3">
                  {a.common.edit}
                </summary>
                <div className="mt-3">
                  <StaffEditor
                    person={person}
                    shopHours={shopHours}
                    shopTimeZone={shopTimeZone}
                    unlocked={unlocked}
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        The add form is the one thing the plan actually withholds. A shop that
        downgrades keeps every person it wrote, keeps editing them, and keeps
        being able to take them off the rota — it just cannot hire.

        Keyed by the size of the roster so a successful add re-mounts it empty:
        the action revalidates, the new row appears above, and the fields the
        seller just typed are not still sitting there looking unsaved.
      */}
      {unlocked ? (
        <div className="border-t border-ink-200 pt-4">
          <p className="mb-3 text-xs font-medium text-ink-700">
            {a.productForm.staffAdd}
          </p>
          <StaffEditor
            key={`add-${roster.length}`}
            shopHours={shopHours}
            shopTimeZone={shopTimeZone}
            unlocked
          />
        </div>
      ) : null}
    </Card>
  );
}

/**
 * One person's fields — the same form whether it adds or edits, because an
 * `id` is the only difference the action cares about.
 */
function StaffEditor({
  person,
  shopHours,
  shopTimeZone,
  unlocked,
}: {
  person?: RosterPerson;
  shopHours: WeeklyHours;
  shopTimeZone: string;
  unlocked: boolean;
}) {
  const a = useAdminT();
  const [state, action, pending] = useActionState(saveStaffMember, IDLE);

  /*
   * "Blank uses the shop's opening hours" is what the hint promises, and a
   * hidden field carrying a week can never be blank — so the checkbox is what
   * says so. Closing all seven days means something else entirely: it is a
   * person who takes no bookings at all.
   */
  const [ownHours, setOwnHours] = useState(Boolean(person?.hours));
  const id = person?.id ?? "new";

  return (
    <form
      /*
       * Dispatched by hand rather than through `action={action}`. React resets
       * an uncontrolled form once a form action completes — it cannot know
       * whether the action succeeded — so a refusal on the calendar address
       * would empty the name, the email and the whole week beside it, and the
       * one thing the seller could act on would cost them everything else.
       */
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-4"
    >
      {person ? <input type="hidden" name="id" value={person.id} /> : null}
      {/*
        The switch on the row is the control for this; the editor carries the
        current value so that saving a name cannot quietly put somebody back on
        the rota. A checkbox would be a second control for one setting.
      */}
      <input
        type="hidden"
        name="isActive"
        value={person ? (person.isActive ? "on" : "off") : "on"}
      />

      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={a.productForm.staffName} htmlFor={`staff-name-${id}`}>
          <Input
            id={`staff-name-${id}`}
            name="name"
            required
            maxLength={120}
            disabled={!unlocked}
            defaultValue={person?.name ?? ""}
          />
        </Field>
        <Field
          label={a.productForm.staffEmail}
          htmlFor={`staff-email-${id}`}
          hint={a.common.optional}
        >
          <Input
            id={`staff-email-${id}`}
            name="email"
            type="email"
            maxLength={200}
            disabled={!unlocked}
            defaultValue={person?.email ?? ""}
          />
        </Field>
      </div>

      <Field
        label={a.productForm.staffTimeZone}
        htmlFor={`staff-zone-${id}`}
        hint={a.common.optional}
      >
        <Select
          id={`staff-zone-${id}`}
          name="timeZone"
          disabled={!unlocked}
          defaultValue={person?.timeZone ?? ""}
        >
          {/*
            Empty is the shop's own zone — and stays the shop's if the shop
            moves, which is why it is a fallback rather than the same string
            stored twice. The shop's zone is dropped from the list below so it
            does not appear as a second, subtly different, way to pick it.
          */}
          <option value="">{shopTimeZone.replace(/_/g, " ")}</option>
          {zoneChoices(shopTimeZone)
            .filter((zone) => zone !== shopTimeZone)
            .map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
        </Select>
      </Field>

      <div className="space-y-3">
        <Switch
          checked={ownHours}
          disabled={!unlocked}
          onChange={(e) => setOwnHours(e.target.checked)}
          label={a.productForm.staffHours}
          description={a.productForm.staffHoursHint}
        />
        {ownHours ? (
          <WeeklyHoursField
            name="staffHours"
            hours={person?.hours ?? shopHours}
            legend={a.productForm.staffHours}
            labelPrefix={person?.name}
          />
        ) : null}
        {/*
          The checkbox is what the action reads, and an unchecked switch posts
          nothing at all — so it is stated rather than inferred from an absent
          field, which is the same value a disabled control would send.
        */}
        <input type="hidden" name="staffOwnHours" value={ownHours ? "on" : "off"} />
      </div>

      <Field
        label={
          person?.feedHost
            ? a.settings.calendarFeedReplace
            : a.productForm.staffFeed
        }
        htmlFor={`staff-feed-${id}`}
        hint={a.common.optional}
        help={a.productForm.staffFeedHint}
      >
        <Input
          id={`staff-feed-${id}`}
          name="calendarFeedUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          disabled={!unlocked}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
        />
      </Field>

      {person?.feedHost ? (
        <>
          <p className="flex items-center gap-1.5 text-xs text-ink-500">
            <CalendarCheck className="size-3.5" />
            {interpolate(a.settings.calendarSyncConnected, {
              host: person.feedHost,
            })}
          </p>
          <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
            <input
              type="checkbox"
              name="calendarFeedRemove"
              disabled={!unlocked}
              className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
            />
            <span className="block text-sm">{a.settings.calendarFeedRemove}</span>
          </label>
        </>
      ) : null}

      <Button type="submit" size="sm" loading={pending} disabled={!unlocked}>
        {person ? a.common.save : a.common.add}
      </Button>
    </form>
  );
}
