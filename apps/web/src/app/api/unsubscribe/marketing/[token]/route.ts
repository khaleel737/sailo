import { optOut } from "@sailo/marketing/lifecycle/server";
import { marketingOptOutUrl, readMarketingOptOutToken } from "@sailo/marketing/lifecycle/server";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";

/**
 * One-click unsubscribe from Sailo's own marketing mail, RFC 8058.
 *
 * The twin of `/api/unsubscribe/[token]`, which does the same job for a
 * shop's broadcasts to its buyers. Two routes rather than one branching on
 * the token, because the two tokens carry different claims and write
 * different tables, and a single route deciding which promise it is keeping
 * is a single route that can keep the wrong one.
 *
 * This is the URI in the `List-Unsubscribe` header, and Gmail's own
 * unsubscribe button POSTs to it with no cookie, no session and no page load.
 * It must therefore work for a completely unauthenticated request — which is
 * the point, and also why the token carries its own signature rather than
 * naming a row somebody could enumerate.
 *
 * The GET does *not* unsubscribe. Mail scanners and security gateways fetch
 * every URL in a message, so a GET that wrote the opt-out row would remove
 * people who never opened the email — and nothing would distinguish that from
 * a real click. It redirects to the confirm page instead.
 */

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/unsubscribe/marketing/[token]">,
) {
  const { token } = await params;

  /*
   * A ceiling, because this is public and writes a row. Generous, because the
   * thing on the other end may be a mail provider unsubscribing several
   * people at once from the same egress address — and being throttled here
   * must never read as "unsubscribed", so a throttled caller is told to retry
   * rather than told it worked.
   */
  const gate = await rateLimit(`unsub-mkt:${await callerIp()}`, 60, 60);
  if (!gate.allowed) {
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }

  /*
   * The param arrives already URL-decoded — decoding again throws a URIError
   * on any token containing a bare `%`, which would be a 500 from the one
   * route that promises a 204 whatever it is fed.
   */
  const claim = readMarketingOptOutToken(token);

  /*
   * A bad signature answers exactly what a good one does.
   *
   * The alternative leaks: "this link is invalid" versus "you're
   * unsubscribed" tells whoever is probing whether a token is real, and
   * therefore whether an address holds a Sailo account. Nothing here is worth
   * that, and the person holding a genuinely broken link is helped by the
   * confirm page, not by us confirming it is broken.
   */
  if (claim) await optOut({ email: claim.email, reason: "unsubscribed" });

  // 204: the mail client is not showing this to anybody.
  return new Response(null, { status: 204 });
}

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/unsubscribe/marketing/[token]">,
) {
  const { token } = await params;
  return Response.redirect(marketingOptOutUrl(token), 302);
}
