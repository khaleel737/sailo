"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCheck,
  Gift,
  MessageSquare,
  ShoppingBag,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import {
  dismissNotification,
  markAllNotificationsRead,
} from "@/lib/actions/notifications";
import { cn } from "@/lib/utils";
import type { Notification, NotificationKind } from "@/lib/notifications";
import type { Dictionary } from "@sailo/i18n";
import type { Locale } from "@sailo/i18n/config";

const ICONS: Record<NotificationKind, typeof Bell> = {
  order: ShoppingBag,
  payment: Wallet,
  review: MessageSquare,
  affiliate: Gift,
  shipment: Truck,
};

const TONES: Record<NotificationKind, string> = {
  order: "bg-blue-100 text-blue-700",
  payment: "bg-amber-100 text-amber-700",
  review: "bg-violet-100 text-violet-700",
  affiliate: "bg-emerald-100 text-emerald-700",
  shipment: "bg-sky-100 text-sky-700",
};

/**
 * `Intl.RelativeTimeFormat` already knows every locale we ship, so relative
 * times need no dictionary entries — and it gets the plural rules right in
 * languages where "2 minutes" and "5 minutes" inflect differently.
 */
function ago(date: Date, locale: Locale, justNow: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return justNow;

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return rtf.format(-days, "day");

  return new Date(date).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

export function NotificationBell({
  items,
  locale,
  t,
}: {
  items: Notification[];
  locale: Locale;
  t: Dictionary;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /**
   * Where the panel's top edge goes on a phone.
   *
   * On a wide screen the panel hangs off the bell and `absolute` is enough. On
   * a phone it cannot: the bell sits ~64px in from the right edge with the menu
   * button beside it, so a 24rem panel anchored to the bell's right edge starts
   * 32px off the left of the screen and clips its own text. There it goes
   * full-width instead, which needs a viewport coordinate rather than an offset
   * from the bell — measured, so the staff banner, RTL and any future change to
   * the bar are all accounted for without hard-coding a height.
   */
  const [top, setTop] = useState(0);

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setTop(rect.bottom + 8);
    };
    place();

    // `pointerdown` rather than `mousedown`: on touch the mouse event is a
    // synthesised afterthought, and on a drag it never arrives at all.
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);

    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const count = items.length;

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t.notifications.title}
        aria-expanded={open}
        aria-controls="notification-panel"
        className="relative flex size-9 items-center justify-center rounded-lg text-ink-600 transition hover:bg-ink-100 hover:text-ink-900 pointer-coarse:size-11"
      >
        <Bell className="size-5" />
        {count > 0 ? (
          <span className="absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id="notification-panel"
          style={{ "--bell-top": `${top}px` } as CSSProperties}
          className={cn(
            "z-50 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl",
            // Phone: pinned to the viewport, a gutter on each side.
            "max-md:fixed max-md:inset-x-4 max-md:top-(--bell-top)",
            // Desktop: hangs off the bell, as before.
            "md:absolute md:end-0 md:mt-2 md:w-96",
          )}
        >
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="text-sm font-semibold">
              {t.notifications.title}
              {count > 0 ? (
                <span className="ms-1.5 font-normal text-ink-400">{count}</span>
              ) : null}
            </p>
            {count > 0 ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await markAllNotificationsRead();
                    setOpen(false);
                  })
                }
                className="focus-ring -my-2 inline-flex items-center gap-1 rounded px-1 py-2 text-xs font-medium text-ink-500 transition hover:text-ink-900 disabled:opacity-50 pointer-coarse:min-h-11"
              >
                <CheckCheck className="size-3.5" />
                {t.notifications.markAllRead}
              </button>
            ) : null}
          </div>

          {count === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell className="mx-auto size-6 text-ink-200" />
              <p className="mt-2 text-sm font-medium text-ink-700">
                {t.notifications.empty}
              </p>
              <p className="mt-0.5 text-xs text-ink-400">
                {t.notifications.emptyBody}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100 overflow-y-auto overscroll-contain max-md:max-h-[min(24rem,calc(100dvh-var(--bell-top)-1.5rem))] md:max-h-96">
              {items.map((item) => {
                const Icon = ICONS[item.kind];
                return (
                  <li key={item.id} className="group flex items-start">
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex min-w-0 flex-1 gap-3 py-3 pe-1 ps-4 transition hover:bg-ink-50"
                    >
                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full",
                          TONES[item.kind],
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-ink-900">
                            {item.title}
                          </span>
                          <span className="shrink-0 text-xs text-ink-400">
                            {ago(item.at, locale, t.notifications.justNow)}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-ink-600">
                          {item.body}
                        </span>
                      </span>
                    </Link>

                    {/*
                      In the row rather than over it. Overlaid it covered the
                      timestamp, and revealed on hover it did not exist on a
                      phone — dismissing was simply unavailable there.
                    */}
                    <form action={dismissNotification} className="shrink-0 pe-2 pt-2.5">
                      <input type="hidden" name="id" value={item.id} />
                      <button
                        type="submit"
                        aria-label={t.notifications.dismiss}
                        className="focus-ring flex size-8 items-center justify-center rounded-md text-ink-400 opacity-0 transition hover:bg-ink-200 hover:text-ink-900 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
                      >
                        <X className="size-3.5" />
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
