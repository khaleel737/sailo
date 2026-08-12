"use client";

import { CalendarCheck, CalendarX, Lock } from "lucide-react";
import { Card, Field, Input } from "@/components/ui";
import { PlanBadge } from "@/app/admin/_components/locked-feature";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { can } from "@/lib/plans";
import { interpolate } from "@sailo/i18n";
import type { Shop } from "@sailo/db/schema";

/**
 * Connecting the seller's other calendar.
 *
 * Read-only and one-directional on purpose. The write direction — putting
 * Sailo bookings into the seller's calendar — needs OAuth, a provider review
 * and a token to keep safe; the read direction needs a URL the seller already
 * has, works with every provider rather than one, and closes the failure that
 * actually happens: a slot offered during something the seller is already
 * committed to.
 *
 * The stored URL is never rendered back. It is a bearer secret — anyone
 * holding it can read the calendar — so the field is always empty and the
 * card reports the host and the status instead. That is also why clearing it
 * is a checkbox rather than an empty save: a blank field has to mean "leave
 * it alone", or saving any other setting on this page would disconnect the
 * calendar silently.
 */
export function CalendarSyncCard({ shop }: { shop: Shop }) {
  const a = useAdminT();
  const unlocked = can(shop, "calendarSync");
  const connected = Boolean(shop.calendarFeedUrl);

  const host = (() => {
    if (!shop.calendarFeedUrl) return null;
    try {
      return new URL(shop.calendarFeedUrl).hostname;
    } catch {
      return null;
    }
  })();

  return (
    <Card className="space-y-4 p-5">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-900">
            {a.settings.calendarSync}
          </h2>
          {unlocked ? null : <PlanBadge feature="calendarSync" />}
        </div>
        <p className="mt-0.5 text-xs text-ink-500">
          {a.settings.calendarSyncBody}
        </p>
      </div>

      {connected ? (
        <div
          className={
            shop.calendarFeedError
              ? "flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-800"
              : "flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900"
          }
        >
          {shop.calendarFeedError ? (
            <CalendarX className="mt-px size-4 shrink-0" />
          ) : (
            <CalendarCheck className="mt-px size-4 shrink-0" />
          )}
          <span>
            <span className="block font-medium">
              {shop.calendarFeedError
                ? a.settings.calendarSyncBroken
                : interpolate(a.settings.calendarSyncConnected, {
                    host: host ?? "",
                  })}
            </span>
            {/*
              The provider's own words, not ours. "the calendar answered 404"
              is the one sentence that tells a seller their link was rotated,
              and paraphrasing it into "something went wrong" throws away the
              only thing they can act on.
            */}
            {shop.calendarFeedError ? (
              <span className="block">{shop.calendarFeedError}</span>
            ) : null}
          </span>
        </div>
      ) : null}

      <Field
        label={
          connected ? a.settings.calendarFeedReplace : a.settings.calendarFeedUrl
        }
        htmlFor="calendarFeedUrl"
        hint={a.settings.calendarFeedUrlHint}
      >
        <Input
          id="calendarFeedUrl"
          name="calendarFeedUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          disabled={!unlocked}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
        />
      </Field>

      {connected ? (
        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            name="calendarFeedRemove"
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
          />
          <span className="block text-sm">{a.settings.calendarFeedRemove}</span>
        </label>
      ) : null}

      {unlocked ? (
        <p className="text-xs text-ink-500">{a.settings.calendarSyncPrivacy}</p>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-ink-500">
          <Lock className="size-3" />
          {a.settings.calendarSyncLocked}
        </p>
      )}
    </Card>
  );
}
