import { NextResponse } from "next/server";
import {
  HANDLED,
  claimEvent,
  handleConnectEvent,
  releaseEvent,
  signingSecrets,
  verifyEvent,
} from "@/lib/stripe-webhooks";

/**
 * Connected accounts — buyers paying sellers.
 *
 * Every card sale is a direct charge on the seller's own Stripe account, and
 * Stripe only delivers those to an endpoint registered *for Connect*. That is a
 * separate registration with its own signing secret, which is why this is a
 * separate route: an ordinary endpoint never sees a single one of these, so an
 * integration with only that one records no payments at all.
 *
 * Register this URL as the Connect endpoint and set
 * `STRIPE_CONNECT_WEBHOOK_SECRET` to its secret.
 */
export async function POST(request: Request) {
  const secrets = signingSecrets(
    // Falling back to the account secret keeps a single-endpoint setup working:
    // some deployments point both registrations at one URL, and a missing
    // variable should not silently drop every payment.
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET ??
      process.env.STRIPE_WEBHOOK_SECRET,
  );
  if (secrets.length === 0) {
    return NextResponse.json(
      { error: "STRIPE_CONNECT_WEBHOOK_SECRET is not set" },
      { status: 500 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

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

  try {
    // Everything arriving here belongs to a shop, whether or not Stripe filled
    // in `account` — this endpoint receives nothing else.
    const outcome = await handleConnectEvent(event, event.account ?? null);
    return NextResponse.json({ received: true, handled: outcome });
  } catch (error) {
    await releaseEvent(event.id);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "handler failed" },
      { status: 500 },
    );
  }
}
