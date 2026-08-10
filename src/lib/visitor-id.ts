import "server-only";
import { createHash } from "node:crypto";

/**
 * A visitor identifier that leaves nothing on the visitor's device.
 *
 * This replaced a `sailo_sid` cookie that lived for six months. That cookie was
 * first-party and held nothing but a random id, which made it feel harmless —
 * but under ePrivacy the test is storage on the device, not what is stored, and
 * an analytics cookie needs consent before it is written. The choice was a
 * consent banner on every seller's storefront, or not needing one. This is not
 * needing one. (A storefront whose seller connects their own marketing tags
 * shows a banner for *those* — `shop-consent.ts` — but this measurement never
 * rides on that consent and keeps working when a buyer declines it.)
 *
 * The id is derived, never stored: a hash of the address, the browser string,
 * the shop and today's date. The address goes into the hash and is thrown away,
 * which is the same promise the privacy policy already made about rate
 * limiting.
 *
 * The cost is honest and worth stating. The salt rotates at midnight UTC, so
 * the same person visiting on two days counts twice — "unique visitors" means
 * unique per day, not unique forever. That is the same trade Plausible and
 * Fathom make, it is what makes the id non-persistent, and non-persistent is
 * the entire point.
 */

const SALT = process.env.ANALYTICS_SALT ?? "";

/** Midnight UTC, so the identifier cannot follow anyone into tomorrow. */
function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function visitorId(
  opts: {
    ip: string | null;
    userAgent: string | null;
    shopId: string;
  },
  now: Date = new Date(),
): string {
  /*
   * The shop is in the hash so the same person browsing two shops is two
   * visitors. Without it, one seller's analytics would be evidence about
   * where their buyers shop next, which is not ours to leak.
   */
  const material = [
    SALT,
    today(now),
    opts.shopId,
    opts.ip ?? "no-ip",
    opts.userAgent ?? "no-ua",
  ].join("\n");

  // Truncated because the full digest is longer than the column needs and a
  // shorter one is no easier to reverse: the input space is the guessable
  // part, which is why the date and the salt are in it.
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}
