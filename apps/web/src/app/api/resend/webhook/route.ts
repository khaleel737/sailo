import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { broadcastDeliveries } from "@sailo/db/schema";
import { suppress } from "@/lib/broadcasts/audience";
import { optOut } from "@/lib/lifecycle/opt-out";
import {
  lifecycleDeliveryByProviderId,
  markLifecycleFailed,
} from "@/lib/lifecycle/send";

/**
 * Bounces and complaints, from Resend.
 *
 * The other half of suppression. An unsubscribe is somebody choosing to
 * leave; a bounce is an address that does not exist and a complaint is
 * somebody pressing "report spam" — and continuing to mail either is how a
 * sending domain gets blocked, which takes every seller's order confirmations
 * down with it. So both write the same suppression row an unsubscribe does.
 *
 * It answers for both kinds of bulk mail Sailo sends — a shop's broadcast to
 * its buyers, and Sailo's own lifecycle mail to its sellers — because Resend
 * has one webhook and the payload names only a message id. Which of the two
 * tables owns that id is what decides whose list the address comes off.
 *
 * Verified the way the Stripe webhooks are, and for the same reason: this
 * endpoint is public and writes rows that stop mail being sent, so an
 * unsigned request is a way for anyone to silence a shop's marketing.
 */

/** Resend signs with Svix. The header carries a space-separated version list. */
function verify(opts: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  body: string;
}): boolean {
  // `whsec_<base64>` — the bytes after the prefix are the key.
  const key = Buffer.from(opts.secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${opts.id}.${opts.timestamp}.${opts.body}`)
    .digest("base64");

  /*
   * Any listed signature matching is a pass, because Svix sends several
   * during a secret rotation. Compared in constant time, and length-checked
   * first — `timingSafeEqual` throws on a mismatch, and a thrown error is
   * itself a signal about the input.
   */
  const expectedBytes = Buffer.from(expected);
  return opts.signature.split(" ").some((entry) => {
    const presented = entry.split(",")[1];
    if (!presented) return false;
    // Byte length, not string length: a header value in the 0x80+ range is
    // one char but two UTF-8 bytes, and `timingSafeEqual` throws on the
    // mismatch — an unauthenticated 500 from the one function that exists
    // to refuse quietly.
    const presentedBytes = Buffer.from(presented);
    if (presentedBytes.length !== expectedBytes.length) return false;
    return timingSafeEqual(presentedBytes, expectedBytes);
  });
}

/** How far out of date a signed request may be, in seconds. */
const TOLERANCE = 5 * 60;

type ResendEvent = {
  type?: string;
  data?: { email_id?: string; to?: string[] | string };
};

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  /*
   * An absent secret is a misconfiguration, and the safe reading of a
   * misconfiguration on an endpoint that writes is "no", not "yes to
   * everyone" — the same rule `cron-auth.ts` had to learn.
   */
  if (!secret) {
    return Response.json(
      { error: "RESEND_WEBHOOK_SECRET is not set" },
      { status: 500 },
    );
  }

  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signature = request.headers.get("svix-signature") ?? "";
  const body = await request.text();

  if (!id || !timestamp || !signature) {
    return Response.json({ error: "unsigned" }, { status: 400 });
  }

  // A replay of a genuinely signed request is still a replay.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE) {
    return Response.json({ error: "stale" }, { status: 400 });
  }

  if (!verify({ secret, id, timestamp, signature, body })) {
    return Response.json({ error: "bad signature" }, { status: 400 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return Response.json({ error: "bad payload" }, { status: 400 });
  }

  const reason =
    event.type === "email.bounced"
      ? ("bounced" as const)
      : event.type === "email.complained"
        ? ("complained" as const)
        : null;
  // Every other event type — delivered, opened, clicked — is acknowledged and
  // ignored. Returning an error would make Resend retry something we do not
  // want.
  if (!reason) return Response.json({ ok: true });

  const providerId = event.data?.email_id;
  if (!providerId) return Response.json({ ok: true });

  /*
   * Two tables can own a provider id, because Sailo sends two kinds of bulk
   * mail: a shop's broadcast to its buyers, and Sailo's own lifecycle mail to
   * its sellers. The id is looked up in both, and whichever owns it decides
   * *which list* the address comes off — a shop's, or ours.
   *
   * Never both, and never inferred from the payload. Suppressing a seller
   * from Sailo's marketing because a buyer bounced would be scoped from a
   * webhook body rather than from the row we wrote when we sent the message,
   * and the row is the only thing that actually knows.
   */
  const db = getDb();

  const delivery = await db.query.broadcastDeliveries.findFirst({
    where: eq(broadcastDeliveries.providerId, providerId),
  });

  if (delivery) {
    await suppress({
      shopId: delivery.shopId,
      email: delivery.email,
      reason,
    });

    await db
      .update(broadcastDeliveries)
      .set({ status: "failed", error: reason })
      .where(
        and(
          eq(broadcastDeliveries.id, delivery.id),
          // Only a delivery we believed had succeeded. A row already marked
          // failed keeps its original reason, which is the more specific one.
          eq(broadcastDeliveries.status, "sent"),
        ),
      );

    return Response.json({ ok: true });
  }

  /*
   * Sailo's own marketing. The opt-out is platform-wide because Sailo is one
   * sender — and it is written whichever way the address failed, since a
   * seller who reports our onboarding mail as spam has said something about
   * every future onboarding mail, not about one of them.
   *
   * Note what this deliberately does *not* touch: `email_suppressions`. A
   * seller bouncing our product mail says nothing about whether their buyers
   * want their shop's newsletter, and quietly muting a shop's marketing
   * because its owner's inbox was full would be a data-loss bug the seller
   * could never find.
   */
  const lifecycle = await lifecycleDeliveryByProviderId(providerId);
  if (!lifecycle) return Response.json({ ok: true });

  await optOut({ email: lifecycle.email, reason });
  await markLifecycleFailed([lifecycle.id], reason);

  return Response.json({ ok: true });
}
