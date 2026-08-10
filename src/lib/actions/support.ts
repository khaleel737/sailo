"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getDb } from "@/db";
import { supportTickets } from "@/db/schema";
import { publishShopEvent } from "@/lib/events";
import { sendSupportTicket } from "@/lib/email";
import { isStoredFileUrl } from "@/lib/file-urls";
import { firstRow } from "@/lib/invariant";
import { rateLimit } from "@/lib/redis";
import { requireShop } from "@/lib/session";
import {
  MAX_MESSAGE_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TICKET_IMAGES,
  isSupportTopic,
} from "@/lib/support";
import type { ActionState } from "./shop";

/**
 * Files a ticket: a row for HQ first, then the email to support with the
 * seller in CC. In that order, so a mail outage degrades to "answered from
 * HQ" rather than "never seen".
 */
export async function createSupportTicket(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user, shop } = await requireShop();

  const topicRaw = String(formData.get("topic") ?? "other");
  const topic = isSupportTopic(topicRaw) ? topicRaw : "other";

  const subject = String(formData.get("subject") ?? "")
    .trim()
    .slice(0, MAX_SUBJECT_LENGTH);
  const message = String(formData.get("message") ?? "")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
  if (!subject) return { ok: false, error: "Give the ticket a subject." };
  if (!message) return { ok: false, error: "Describe what's happening." };

  /*
   * Screenshots must live on our own storage. A server action takes whatever
   * the client posts, and these URLs end up in a support email and on an HQ
   * page staff will click — an arbitrary link here is a phishing lure wearing
   * our layout.
   */
  const imageUrls = formData
    .getAll("imageUrls")
    .filter(isStoredFileUrl)
    .slice(0, MAX_TICKET_IMAGES);

  // Per shop, not per IP: the form sits behind a login, and the thing being
  // protected is the support inbox rather than the send quota.
  const gate = await rateLimit(`support:${shop.id}`, 5, 3600);
  if (!gate.allowed) {
    return {
      ok: false,
      error:
        "You've opened a few tickets in the last hour — give us a moment to catch up. We reply to every one.",
    };
  }

  const ticket = firstRow(
    await getDb()
      .insert(supportTickets)
      .values({
        shopId: shop.id,
        email: user.email,
        topic,
        subject,
        message,
        imageUrls,
      })
      .returning(),
    "created ticket",
  );

  // Best effort — the ticket already exists for HQ whether or not this lands.
  const result = await sendSupportTicket({
    shopName: shop.name,
    handle: shop.handle,
    email: user.email,
    topic,
    subject,
    message,
    imageUrls,
    ticketId: ticket.id,
  });
  if (!result.sent) {
    console.warn(`[sailo] support ticket email not sent: ${result.reason}`);
  }

  revalidatePath("/admin/support");
  revalidatePath("/hq/support");
  // The bus mirrors support events onto the hq channel, so an open staff
  // desk sees the ticket arrive without anyone reloading it.
  after(() => publishShopEvent(shop.id, "support"));
  return { ok: true, message: "Ticket sent — we'll reply by email." };
}
