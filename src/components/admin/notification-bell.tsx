"use client";

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

function ago(date: Date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function NotificationBell({ items }: { items: Notification[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = items.length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={count ? `${count} notifications` : "Notifications"}
        aria-expanded={open}
        className="relative flex size-9 items-center justify-center rounded-lg text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
      >
        <Bell className="size-5" />
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="text-sm font-semibold">
              Notifications
              {count > 0 ? (
                <span className="ml-1.5 font-normal text-ink-400">{count}</span>
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
                className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition hover:text-ink-900 disabled:opacity-50"
              >
                <CheckCheck className="size-3.5" />
                Mark all read
              </button>
            ) : null}
          </div>

          {count === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell className="mx-auto size-6 text-ink-200" />
              <p className="mt-2 text-sm font-medium text-ink-700">All caught up</p>
              <p className="mt-0.5 text-xs text-ink-400">
                New orders and reviews will appear here.
              </p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-ink-100 overflow-y-auto">
              {items.map((item) => {
                const Icon = ICONS[item.kind];
                return (
                  <li key={item.id} className="group relative">
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex gap-3 px-4 py-3 transition hover:bg-ink-50"
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
                            {ago(item.at)}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-ink-600">
                          {item.body}
                        </span>
                      </span>
                    </Link>

                    <form
                      action={dismissNotification}
                      className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100"
                    >
                      <input type="hidden" name="id" value={item.id} />
                      <button
                        type="submit"
                        aria-label="Dismiss"
                        className="flex size-6 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-200 hover:text-ink-900"
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
