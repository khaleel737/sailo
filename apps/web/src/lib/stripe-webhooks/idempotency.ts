import "server-only";
import type Stripe from "stripe";
import { getDb } from "@sailo/db";
import { stripeEvents } from "@sailo/db/schema";
import { eq } from "drizzle-orm";

/**
 * At-least-once delivery, handled once.
 *
 * Stripe retries an event until it gets a 2xx, and will happily deliver the
 * same one twice on its own. Claiming the id before doing the work is what
 * makes "paid" idempotent; releasing it on a throw is what lets the retry
 * actually retry rather than being swallowed by our own claim.
 */

/**
 * Records the event id, returning false if it has been seen before.
 *
 * The empty result *is* the signal — `onConflictDoNothing` returns no rows
 * precisely when this event is a replay. Stripe delivers at least once, so this
 * runs constantly and must never throw: a non-2xx makes Stripe retry the same
 * event for three days and can get the endpoint disabled.
 */
export async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const [claimed] = await getDb()
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing({ target: stripeEvents.id })
    .returning({ id: stripeEvents.id });
  return Boolean(claimed);
}

/** Lets Stripe's retry have another go at an event whose handler threw. */
export async function releaseEvent(eventId: string) {
  await getDb().delete(stripeEvents).where(eq(stripeEvents.id, eventId));
}
