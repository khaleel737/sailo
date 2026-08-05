"use server";

import { portalLinksForEmail } from "@/lib/affiliate-portal";
import { sendPortalLinks } from "@/lib/email";
import { rateLimit } from "@/lib/redis";
import { callerIp } from "@/lib/client-ip";

/**
 * Emails an affiliate their private report links.
 *
 * Always answers the same way. Telling an anonymous visitor whether an address
 * is registered would turn this box into a way to find out who promotes a
 * shop, which is nobody's business but theirs.
 */
export async function requestPortalLink(email: string): Promise<{ ok: true }> {
  /*
   * Sends mail to an address the caller chooses, which makes an unthrottled
   * version two things at once: a way to flood someone's inbox, and a way to
   * spend the sending quota. The answer stays `ok` either way — saying "rate
   * limited" to one address and "ok" to another would leak exactly what the
   * constant reply is here to hide.
   */
  const gate = await rateLimit(`portal:${await callerIp()}`, 5, 900);
  if (!gate.allowed) return { ok: true };

  const address = email.trim().toLowerCase();
  if (address.includes("@") && address.length < 200) {
    const links = await portalLinksForEmail(address);
    if (links.length > 0) {
      const result = await sendPortalLinks({ to: address, links });
      if (!result.sent) {
        console.warn(`[sailo] portal link email not sent: ${result.reason}`);
      }
    }
  }
  return { ok: true };
}
