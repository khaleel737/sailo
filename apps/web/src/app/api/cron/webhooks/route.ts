import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/cron-auth";
import { runWebhookQueue } from "@/lib/webhooks/deliver";

/**
 * One tick of the webhook delivery queue.
 *
 * A cron rather than a send at the moment the event happens, for the same
 * reason the broadcast queue is one: the thing being talked to is somebody
 * else's server, and it may be slow, down, or a redirect loop. Putting that on
 * the buyer's checkout — or on a Stripe webhook whose reply Stripe is timing —
 * means a stranger's misconfigured endpoint decides how fast this shop takes
 * money.
 *
 * Every five minutes, matching the broadcast queue. A webhook that lands
 * within five minutes is well inside what every consumer expects, and a
 * shorter interval would mostly bill us for empty ticks: the overwhelming
 * majority of shops have no endpoints at all, and the drain's first query
 * returns nothing.
 *
 * Safe to run twice. Every row is claimed by a conditional UPDATE that leases
 * it forward, so an overlapping tick claims nothing and posts nothing.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const result = await runWebhookQueue();

  return NextResponse.json({ ok: true, ...result });
}
