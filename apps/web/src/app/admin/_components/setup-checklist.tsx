"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import {
  Card,
  CardsArt,
  LinkArt,
  ParcelArt,
  PeopleArt,
} from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { setupProgress, type SetupStep, type SetupStepId } from "@sailo/core/onboarding";
import { useAdminLocale, useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * "Store setup — 2 of 4", on the seller's dashboard until it isn't needed —
 * as Shopify's task-card grid (docs/admin-redesign 03): each step is a card
 * with its own drawing, one act, and a progress ring in the header that
 * draws itself once on first paint.
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

  const labels: Record<SetupStepId, { title: string; hint: string; cta: string }> = {
    photo: { title: a.setup.photo, hint: a.setup.photoHint, cta: a.setup.photoCta },
    product: {
      title: a.setup.product,
      hint: a.setup.productHint,
      cta: a.setup.productCta,
    },
    paid: { title: a.setup.paid, hint: a.setup.paidHint, cta: a.setup.paidCta },
    social: {
      title: a.setup.social,
      hint: a.setup.socialHint,
      cta: a.setup.socialCta,
    },
  };

  /* One drawing per step, from the same hand as the empty states. */
  const art: Record<SetupStepId, React.ReactNode> = {
    photo: <PeopleArt />,
    product: <ParcelArt />,
    paid: <CardsArt />,
    social: <LinkArt />,
  };

  return (
    <Card className="mb-6 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/*
            The ring — drawn once on first paint (300–500ms, ease-out) and
            still for everyone after that. `pathLength="1"` makes the dash
            arithmetic unit-free; reduced motion skips straight to the value.
          */}
          <svg viewBox="0 0 24 24" aria-hidden className="size-9 shrink-0 -rotate-90">
            <circle
              cx="12"
              cy="12"
              r="10"
              pathLength={1}
              fill="none"
              strokeWidth="2.5"
              className="stroke-ink-100"
            />
            <circle
              cx="12"
              cy="12"
              r="10"
              pathLength={1}
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="1"
              strokeDashoffset={1 - ratio}
              className="animate-ring-draw stroke-brand-600 motion-reduce:animate-none"
            />
          </svg>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink-900">
              {a.setup.title}
              <span className="ms-2 text-xs font-medium tabular-nums text-ink-400">
                {interpolate(a.setup.count, {
                  done: done.toLocaleString(locale),
                  total: total.toLocaleString(locale),
                })}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">{a.setup.body}</p>
          </div>
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

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {steps.map((step) => {
          const { title, hint, cta } = labels[step.id];

          /*
           * A finished step keeps its card — "2 of 4" has to be countable on
           * the screen it describes — but quiets down: ticked, dimmed art,
           * and no button, because there is nothing left to go and do.
           */
          if (step.done) {
            return (
              <li key={step.id}>
                <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-ink-100 bg-ink-50/60 p-4">
                  <p className="flex items-center gap-2 pe-20 text-sm font-medium text-ink-400">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <span className="line-through">{title}</span>
                  </p>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -bottom-3 -end-3 opacity-30 grayscale [&_svg]:h-16 [&_svg]:w-auto"
                  >
                    {art[step.id]}
                  </span>
                </div>
              </li>
            );
          }

          return (
            <li key={step.id}>
              {/*
                Hover lifts with shadow only — scale would shift the grid
                (layout stability rule). One act per card, bottom-left, the
                drawing bottom-right where Shopify parks its illustrations.
              */}
              <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white p-4 transition-shadow duration-150 hover:shadow-md">
                <h3 className="pe-16 text-sm font-semibold text-ink-900">{title}</h3>
                <p className="mt-1 pe-24 text-xs leading-relaxed text-ink-500">
                  {hint}
                </p>
                <div className="mt-auto pt-4">
                  <Link
                    href={step.href}
                    className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-700 transition hover:bg-ink-50 pointer-coarse:h-11"
                  >
                    {cta}
                    <ArrowRight className="size-3.5 rtl:rotate-180" />
                  </Link>
                </div>
                <span
                  aria-hidden
                  className="pointer-events-none absolute -bottom-3 -end-3 [&_svg]:h-20 [&_svg]:w-auto"
                >
                  {art[step.id]}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
