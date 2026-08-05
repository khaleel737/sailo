"use server";

import { portalLinksForEmail } from "@/lib/affiliate-portal";
import { sendPortalLinks } from "@/lib/email";

/**
 * Emails an affiliate their private report links.
 *
 * Always answers the same way. Telling an anonymous visitor whether an address
 * is registered would turn this box into a way to find out who promotes a
 * shop, which is nobody's business but theirs.
 */
export async function requestPortalLink(email: string): Promise<{ ok: true }> {
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
