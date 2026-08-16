"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import { Card, Progress } from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { setupProgress, type SetupStep, type SetupStepId } from "@sailo/core/onboarding";
import { useAdminLocale, useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * "Store setup — 2 of 4", on the seller's dashboard until it isn't needed.
 *
 * The steps themselves are computed on the server (`@sailo/core/onboarding`);
 * this is only the card that draws them, and the one piece of state it owns is
 * whether this browser has dismissed it.
 *
 * That state is `localStorage`, not a column, for the same reason the consent
 * choice is: a dismissed checklist is a preference of the person looking at
 * the screen, not a fact about the shop. Storing it on `shops` would mean a
 * seller who dismissed it on their laptop finds it gone on their phone too,
 * and a migration for a boolean nobody will ever query.
 *
 * Dismissal is per shop, so someone who runs two shops from one browser is
 * not told the second one is set up because the first one was.
 */

const DISMISS_PREFIX = "sailo_setup_dismissed:";
/** Fired on dismiss so the card unmounts without a reload. */
const DISMISS_EVENT = "sailo:setup-dismissed";

const dismissKey = (shopId: string) => `${DISMISS_PREFIX}${shopId}`;

function subscribe(onChange: () => void) {
  window.addEventListener(DISMISS_EVENT, onChange);
  // Dismissing in another tab counts as dismissing.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DISMISS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readDismissed(shopId: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(shopId)) !== null;
  } catch {
    // Private browsing or a full quota. Showing the card is the safe side of
    // this: an undismissable card is an annoyance, a card that hides itself
    // for a reason nobody can see is a bug report.
    return false;
  }
}

export function SetupChecklist({
  shopId,
  steps,
}: {
  shopId: string;
  steps: SetupStep[];
}) {
  const a = useAdminT();
  const locale = useAdminLocale();

  const dismissed = useSyncExternalStore(
    subscribe,
    () => readDismissed(shopId),
    // Never guess during server rendering: the answer lives in this browser,
    // and guessing "not dismissed" flashes the card at someone who dismissed it.
    () => true,
  );

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(dismissKey(shopId), new Date().toISOString());
    } catch {
      // Nothing to do — the card simply stays for this browser.
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }, [shopId]);

  const { done, total, complete, ratio } = setupProgress(steps);

  // A finished checklist is not a trophy, it is clutter. It goes on its own,
  // which is also why there is no "reset" — the data that ticked it is the
  // data that would untick it.
  if (complete || dismissed) return null;

  const labels: Record<SetupStepId, { title: string; hint: string }> = {
    photo: { title: a.setup.photo, hint: a.setup.photoHint },
    product: { title: a.setup.product, hint: a.setup.productHint },
    paid: { title: a.setup.paid, hint: a.setup.paidHint },
    social: { title: a.setup.social, hint: a.setup.socialHint },
  };

  return (
    <Card className="mb-6 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-900">{a.setup.title}</h2>
          <p className="mt-0.5 text-xs text-ink-500">{a.setup.body}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={a.setup.dismiss}
          className="focus-ring press -m-1.5 shrink-0 rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-900 pointer-coarse:-m-2.5 pointer-coarse:p-2.5"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Progress
          value={ratio}
          label={a.setup.title}
          className="min-w-0 flex-1"
        />
        <span className="shrink-0 text-xs font-medium tabular-nums text-ink-500">
          {interpolate(a.setup.count, {
            done: done.toLocaleString(locale),
            total: total.toLocaleString(locale),
          })}
        </span>
      </div>

      <ul className="mt-4 divide-y divide-ink-100">
        {steps.map((step) => {
          const { title, hint } = labels[step.id];

          /*
           * A finished step stays on the list rather than disappearing —
           * "2 of 4" has to be countable on the screen it describes — but it
           * stops being a link. There is nothing left to go and do, and a
           * chevron next to a tick invites a trip to a page that will not
           * change anything.
           */
          if (step.done) {
            return (
              <li
                key={step.id}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span className="min-w-0 truncate text-sm text-ink-400 line-through">
                  {title}
                </span>
              </li>
            );
          }

          return (
            <li key={step.id} className="first:-mt-1 last:-mb-1">
              <Link
                href={step.href}
                className="focus-ring group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-ink-50 pointer-coarse:min-h-11"
              >
                <span className="size-5 shrink-0 rounded-full border-2 border-ink-200 transition group-hover:border-ink-300" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">
                    {title}
                  </span>
                  <span className="block truncate text-xs text-ink-500">
                    {hint}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-ink-300 transition group-hover:text-ink-500 rtl:rotate-180" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
