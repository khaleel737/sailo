"use client";

import { Card, Field, Input, Switch } from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { wantsNotification } from "@sailo/notifications/prefs";
import type { Shop } from "@sailo/db/schema";

/**
 * Which emails Sailo sends the *seller* about their own shop — as opposed to
 * everything in `messages.ts`, which goes to their buyers and is not
 * negotiable.
 *
 * A dumb card, like the others on this page: named checkboxes inside the
 * settings form, saved by `updateShop` with everything else. Each switch is
 * checked when the event is wanted, and `readNotificationPrefs` stores only
 * the ones turned off.
 */
export function NotificationsCard({
  shop,
  accountEmail,
  marketingOptIn,
}: {
  shop: Shop;
  /** Where these land: the shop's contact address, else the login email. */
  accountEmail: string;
  /**
   * Whether Sailo may still send this seller product mail.
   *
   * Passed in rather than read off `shop`, because unlike every other switch
   * on this card it is not a shop setting. It is keyed on the *account*
   * address in `marketing_opt_outs`, platform-wide and outliving the shop —
   * which is what lets an unsubscribe from a cold mail client, with no
   * session and no shop, still be honoured here.
   */
  marketingOptIn: boolean;
}) {
  const a = useAdminT();
  const prefs = shop.notificationPrefs;

  const ROWS = [
    {
      event: "orderPlaced",
      label: a.settings.notifyOrderPlaced,
      description: a.settings.notifyOrderPlacedBody,
    },
    {
      event: "bookingRequested",
      label: a.settings.notifyBookingRequested,
      description: a.settings.notifyBookingRequestedBody,
    },
    {
      event: "orderNeedsAction",
      label: a.settings.notifyOrderNeedsAction,
      description: a.settings.notifyOrderNeedsActionBody,
    },
    /*
     * The membership three, which had no switches because they had no mail.
     * A member could join, cancel or fail a renewal and the seller was told
     * nothing — see `@sailo/notifications/prefs` for the whole note.
     */
    {
      event: "membershipStarted",
      label: a.settings.notifyMembershipStarted,
      description: a.settings.notifyMembershipStartedBody,
    },
    {
      event: "membershipCancelled",
      label: a.settings.notifyMembershipCancelled,
      description: a.settings.notifyMembershipCancelledBody,
    },
    {
      event: "membershipPaymentFailed",
      label: a.settings.notifyMembershipPaymentFailed,
      description: a.settings.notifyMembershipPaymentFailedBody,
    },
  ] as const;

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.settings.notifications}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.settings.notificationsBody}</p>
      </div>

      <div className="space-y-3">
        {ROWS.map((row) => (
          <Switch
            key={row.event}
            name={`notify_${row.event}`}
            defaultChecked={wantsNotification(prefs, row.event)}
            label={row.label}
            description={row.description}
          />
        ))}

        {/*
          Sailo's own mail, under the same heading because this is where a
          seller looks for "stop emailing me" — but it is a different promise
          from the three above, which are about their shop, and the
          description says so rather than leaving them to find out.
        */}
        <Switch
          name="marketing_opt_in"
          defaultChecked={marketingOptIn}
          label={a.settings.notifyProductTips}
          description={a.settings.notifyProductTipsBody}
        />
      </div>

      {/*
        Where these land, and the chance to send them somewhere else.

        Deliberately *not* the "leave empty to disable all" field the tool this
        screen was modelled on uses. It ships empty for every shop that already
        exists, so reading empty as silence would have switched off every
        seller's order alerts on the morning it deployed. Empty here means the
        fallback it has always meant — contact address, then the account's —
        and the switches above are how an alert is turned off.
      */}
      <div className="space-y-1.5 border-t border-ink-200 pt-4">
        <Field
          label={a.settings.notificationEmail}
          htmlFor="notificationEmail"
          hint={a.common.optional}
        >
          <Input
            id="notificationEmail"
            name="notificationEmail"
            type="email"
            autoComplete="email"
            defaultValue={shop.notificationEmail ?? ""}
            placeholder={shop.contactEmail ?? accountEmail}
          />
        </Field>
        <p className="text-xs text-ink-500">
          {interpolate(a.settings.notifySentTo, {
            email: shop.notificationEmail ?? shop.contactEmail ?? accountEmail,
          })}
        </p>
      </div>
    </Card>
  );
}
