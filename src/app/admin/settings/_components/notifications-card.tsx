"use client";

import { Card, Switch } from "@/components/ui";
import { interpolate } from "@/i18n";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { wantsNotification } from "@/lib/notification-prefs";
import type { Shop } from "@/db/schema";

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
}: {
  shop: Shop;
  /** Where these land: the shop's contact address, else the login email. */
  accountEmail: string;
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
      </div>

      <p className="text-xs text-ink-500">
        {interpolate(a.settings.notifySentTo, {
          email: shop.contactEmail ?? accountEmail,
        })}
      </p>
    </Card>
  );
}
