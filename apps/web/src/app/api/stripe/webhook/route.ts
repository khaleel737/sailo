import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  HANDLED,
  claimEvent,
  releaseEvent,
  signingSecrets,
  verifyEvent,
} from "@sailo/payments";
import { handleAccountEvent, handleConnectEvent } from "@/lib/stripe-webhooks";

/**
 * Sailo's own Stripe account — sellers paying us.
 *
 * Subscriptions, invoices, plan changes. Register this URL as an ordinary
 * webhook endpoint; buyer payments arrive at `/api/stripe/connect/webhook`
 * instead, because Stripe will not deliver connected-account events here.
 *
 * One exception keeps a shop order in scope: a seller whose Stripe account *is*
 * the platform's own is charged directly, so their session arrives with no
 * `account` field and would otherwise fall into the subscription branch and be
 * ignored — leaving the order unpaid with the buyer's money taken.
 */
export async function POST(request: Request) {
  const secrets = signingSecrets(process.env.STRIPE_WEBHOOK_SECRET);
  if (secrets.length === 0) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET is not set" },
      { status: 500 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  // The raw body is required — parsing it first would break verification.
  const payload = await request.text();
  const verified = verifyEvent(payload, signature, secrets);
  if ("error" in verified) {
    return NextResponse.json(
      { error: `signature verification failed: ${verified.error}` },
      { status: 400 },
    );
  }

  // A v2 "thin" destination. Genuinely from Stripe, genuinely not something
  // this integration reads — acknowledged so it is never retried.
  if ("thin" in verified) {
    return NextResponse.json({ received: true, ignored: verified.type });
  }

  const { event } = verified;
  if (!(await claimEvent(event))) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const isShopOrder =
    Boolean(event.account) ||
    event.type === "charge.refunded" ||
    event.type.startsWith("charge.dispute.") ||
    event.type === "checkout.session.expired" ||
    (event.type === "checkout.session.completed" &&
      (event.data.object as Stripe.Checkout.Session).mode === "payment");

  try {
    const outcome = isShopOrder
      ? await handleConnectEvent(event, event.account ?? null)
      : await handleAccountEvent(event);
    return NextResponse.json({ received: true, handled: outcome });
  } catch (error) {
    // Release the claim so Stripe's retry can have another go.
    await releaseEvent(event.id);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "handler failed" },
      { status: 500 },
    );
  }
}
