import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { suppress } from "@sailo/marketing/broadcasts/server";
import { readUnsubscribeToken, unsubscribeUrl } from "@sailo/marketing/broadcasts/server";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";

/**
 * One-click unsubscribe, RFC 8058.
 *
 * This is the URI in the `List-Unsubscribe` header, and Gmail's own
 * unsubscribe button POSTs to it with no cookie, no session and no page load.
 * It must therefore work for a completely unauthenticated request — which is
 * the whole point, and also why the token carries its own signature rather
 * than naming a row someone could enumerate.
 *
 * The GET does *not* unsubscribe. Mail scanners and security gateways fetch
 * every URL in a message, so a GET that suppressed an address would remove
 * people who never opened the email — and nothing would distinguish that from
 * a real click. It redirects to the confirm page instead.
 */

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/unsubscribe/[token]">,
) {
  const { token } = await params;

  /*
   * A ceiling, because this is public and writes a row. Generous, because
   * the thing on the other end may be a mail provider unsubscribing several
   * people at once from the same egress address — and being throttled here
   * must never read as "unsubscribed", so a throttled caller is told to
   * retry rather than told it worked.
   */
  const gate = await rateLimit(`unsub:${await callerIp()}`, 60, 60);
  if (!gate.allowed) {
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }

  /*
   * The param arrives already URL-decoded — decoding again threw a URIError
   * on any token containing a bare `%`, a 500 where this route promises a
   * 204 whatever it is fed. Every other token route uses the param as-is.
   */
  const claim = readUnsubscribeToken(token);
  /*
   * A bad signature answers exactly what a good one does.
   *
   * The alternative leaks: "this link is invalid" versus "you're
   * unsubscribed" tells whoever is probing whether a token is real, and
   * therefore whether an address is on a given shop's list. Nothing here is
   * worth that, and the person holding a genuinely broken link is helped by
   * the shop's own footer, not by us confirming it is broken.
   */
  if (!claim) return new Response(null, { status: 204 });

  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.id, claim.shopId),
    columns: { id: true },
  });
  if (shop) {
    await suppress({
      shopId: claim.shopId,
      email: claim.email,
      reason: "unsubscribed",
    });
  }

  // 204: the mail client is not showing this to anybody.
  return new Response(null, { status: 204 });
}

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/unsubscribe/[token]">,
) {
  const { token } = await params;
  return Response.redirect(unsubscribeUrl(token), 302);
}
