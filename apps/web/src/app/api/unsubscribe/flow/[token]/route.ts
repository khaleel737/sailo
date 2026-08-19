import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { automations } from "@sailo/db/schema";
import {
  automationUnsubUrl,
  optOutOfAutomation,
  readAutomationUnsubToken,
} from "@sailo/marketing/automations/server";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";

/**
 * One-click unsubscribe from one flow, RFC 8058.
 *
 * The twin of `/api/unsubscribe/[token]`, and separate from it because the two
 * write different things: that one suppresses an address for a whole shop, and
 * this one stops a single sequence and touches no list. A shared route taking
 * "which kind" as a parameter would put that choice in the token, which is
 * exactly where a replay would want it.
 *
 * The tokens cannot be confused for each other — each family is keyed by its
 * own derivation — so a token minted to leave one flow can never be presented
 * here or there as the other.
 *
 * The GET does *not* unsubscribe. Mail scanners and security gateways fetch
 * every URL in a message, so a GET that acted would stop sequences for people
 * who never opened the email, with nothing to distinguish that from a click.
 */

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/unsubscribe/flow/[token]">,
) {
  const { token } = await params;

  /*
   * Generous, because the caller may be a mail provider unsubscribing several
   * people at once from one egress address — and being throttled here must
   * never read as "unsubscribed", so a throttled caller is told to retry.
   */
  const gate = await rateLimit(`unsub-flow:${await callerIp()}`, 60, 60);
  if (!gate.allowed) {
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }

  // The param arrives already URL-decoded; decoding again throws a URIError on
  // a bare `%`, which is a 500 where this route promises a 204.
  const claim = readAutomationUnsubToken(token);
  /*
   * A bad signature answers exactly what a good one does. "This link is
   * invalid" versus "you're unsubscribed" tells whoever is probing whether a
   * token is real, and therefore whether an address is in a given flow.
   */
  if (!claim) return new Response(null, { status: 204 });

  const automation = await getDb().query.automations.findFirst({
    where: eq(automations.id, claim.automationId),
    columns: { id: true },
  });
  if (automation) await optOutOfAutomation(claim);

  // 204: the mail client is not showing this to anybody.
  return new Response(null, { status: 204 });
}

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/unsubscribe/flow/[token]">,
) {
  const { token } = await params;
  return Response.redirect(automationUnsubUrl(token), 302);
}
