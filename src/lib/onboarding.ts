import type { ShopSocial } from "@/db/schema";

/**
 * "Store setup — 2 of 4": what a seller who just signed up still has to do.
 *
 * Every step is *derived*, never stored. There is no `onboardingState`
 * column and no migration behind this file, because a stored copy of "has
 * this seller added a photo" is a second answer to a question the shop row
 * already answers — and the two drift the first time a photo is deleted, a
 * payment rail is switched off, or a product is removed. Deriving also means
 * a tick is instant on the next render with no cache to invalidate and
 * nothing to backfill for the sellers who signed up before this existed.
 *
 * Four steps, not the five the spec sketched, and the two differences are
 * deliberate:
 *
 *   - **"Publish your shop" is not a step.** `shops.isPublished` defaults to
 *     `true`, so it is ticked from the moment the shop exists. A row that
 *     cannot be failed is decoration on a progress card, and it would have
 *     made every brand-new seller open on 1/5 for doing nothing.
 *   - **"Share your link" is not a step either.** The dashboard already
 *     opens with the link in a full-width block, with copy and visit buttons
 *     in it. Asking for the same thing again ten rows lower is the card
 *     competing with the page it sits on.
 *
 * What is left is four things the seller does, in the admin, that each
 * change what a buyer sees.
 */

/** In the order they're shown. The card ticks them off in place. */
export const SETUP_STEP_IDS = ["photo", "product", "paid", "social"] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

/**
 * The columns each step reads, and nothing else.
 *
 * A narrow input rather than the whole `Shop` row so the derivation stays
 * testable from a literal, and so adding a step is visibly a change to what
 * the dashboard has to load.
 */
export type SetupSignals = {
  avatarUrl: string | null;
  logoUrl: string | null;
  socials: ShopSocial[];
  /** Every product, published or not — a draft still counts as "you added one". */
  productCount: number;
  /**
   * Enabled rows in `paymentMethods`. Cash on delivery, a bank transfer and a
   * WhatsApp handoff all count. This is the step most likely to be copied
   * wrong from another platform: a seller in a market where nobody takes
   * cards is fully set up without Stripe, and telling them otherwise is
   * telling them their shop is broken when it is working.
   */
  enabledRailCount: number;
  /** Cards, through the seller's own Connect account. */
  stripeChargesEnabled: boolean;
};

export type SetupStep = {
  id: SetupStepId;
  done: boolean;
  /** The page that completes it — the row is a link, not a reminder. */
  href: string;
};

export function setupSteps(signals: SetupSignals): SetupStep[] {
  return [
    {
      id: "photo",
      // Either image reads as "this shop has a face"; the storefront falls
      // back from one to the other, so requiring a specific one would ask
      // for work that changes nothing.
      done: Boolean(signals.avatarUrl ?? signals.logoUrl),
      href: "/admin/settings",
    },
    {
      id: "product",
      done: signals.productCount > 0,
      href: "/admin/products/new",
    },
    {
      id: "paid",
      done: signals.enabledRailCount > 0 || signals.stripeChargesEnabled,
      href: "/admin/payments",
    },
    {
      id: "social",
      done: signals.socials.length > 0,
      href: "/admin/settings",
    },
  ];
}

export type SetupProgress = {
  done: number;
  total: number;
  /** Nothing left to do — the card stops rendering. */
  complete: boolean;
  /** 0–1, for the bar. */
  ratio: number;
};

export function setupProgress(steps: SetupStep[]): SetupProgress {
  const done = steps.filter((step) => step.done).length;
  const total = steps.length;
  return { done, total, complete: done === total, ratio: total ? done / total : 1 };
}
