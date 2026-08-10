import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { broadcastDeliveries } from "@/db/schema";
import { suppress } from "@/lib/broadcasts/audience";

/**
 * Bounces and complaints, from Resend.
 *
 * The other half of suppression. An unsubscribe is somebody choosing to
 * leave; a bounce is an address that does not exist and a complaint is
 * somebody pressing "report spam" — and continuing to mail either is how a
 * sending domain gets blocked, which takes every seller's order confirmations
 * down with it. So both write the same suppression row an unsubscribe does.
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
   * The shop is found through the delivery row rather than taken from the
   * payload. Suppression is per shop, and a webhook body is not a statement
   * about which shop's list an address belongs on — the row we wrote when we
   * sent the message is.
   */
  const db = getDb();
  const delivery = await db.query.broadcastDeliveries.findFirst({
    where: eq(broadcastDeliveries.providerId, providerId),
  });
  if (!delivery) return Response.json({ ok: true });

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
