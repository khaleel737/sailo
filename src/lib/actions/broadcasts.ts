"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { broadcasts } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { can, upgradeMessage } from "@/lib/plans";
import { normalizeTag } from "@/lib/client-tags";
import { queueBroadcast } from "@/lib/broadcasts/send";
import { budgetFor } from "@/lib/broadcasts/quota";
import { renderBroadcast, renderText } from "@/lib/broadcasts/render";
import {
  unsubscribeToken,
  unsubscribeUrl,
} from "@/lib/broadcasts/unsubscribe";
import { ORDERS, send, sender } from "@/lib/email/transport";
import { getDictionary } from "@/i18n";
import { rateLimit } from "@/lib/redis";

/** Writing, previewing and sending a broadcast. */

export type BroadcastState = { ok: boolean; error?: string; message?: string };

const MAX_SUBJECT = 200;
const MAX_BODY = 20_000;

function read(formData: FormData) {
  return {
    subject: String(formData.get("subject") ?? "").trim().slice(0, MAX_SUBJECT),
    bodyMarkdown: String(formData.get("body") ?? "").trim().slice(0, MAX_BODY),
    audienceTag: normalizeTag(String(formData.get("tag") ?? "")),
  };
}

/** Creates or updates a draft. Never sends. */
export async function saveBroadcast(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  const { shop } = await requireShop();
  if (!can(shop, "broadcasts")) {
    return { ok: false, error: upgradeMessage("broadcasts", "Email broadcasts") };
  }

  const { subject, bodyMarkdown, audienceTag } = read(formData);
  if (!subject) return { ok: false, error: "Give it a subject line." };
  if (!bodyMarkdown) return { ok: false, error: "Write something to send." };

  const db = getDb();
  const id = String(formData.get("id") ?? "");

  if (id) {
    /*
     * `status = 'draft'` is in the WHERE, not checked above it. A broadcast
     * already in flight must not have its subject or body rewritten under
     * the batches still to go out — half the list would get one email and
     * half another, both claiming to be the same send.
     */
    const [updated] = await db
      .update(broadcasts)
      .set({ subject, bodyMarkdown, audienceTag, updatedAt: new Date() })
      .where(
        and(
          eq(broadcasts.id, id),
          eq(broadcasts.shopId, shop.id),
          eq(broadcasts.status, "draft"),
        ),
      )
      .returning({ id: broadcasts.id });
    if (!updated) return { ok: false, error: "That draft can't be edited." };

    revalidatePath("/admin/broadcasts");
    revalidatePath(`/admin/broadcasts/${id}`);
    return { ok: true, message: "Draft saved." };
  }

  const [created] = await db
    .insert(broadcasts)
    .values({ shopId: shop.id, subject, bodyMarkdown, audienceTag })
    .returning({ id: broadcasts.id });

  revalidatePath("/admin/broadcasts");
  if (created) redirect(`/admin/broadcasts/${created.id}`);
  return { ok: true, message: "Draft saved." };
}

/**
 * Sends one copy to the seller's own address.
 *
 * Its own path rather than a flag on the real send, because it must not touch
 * the queue, must not count against the quota's meaning, and must reach an
 * address that has given no consent — the seller's own. That last point is
 * why it cannot be "send to an audience of one".
 */
export async function testSendBroadcast(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  const { shop, user } = await requireShop();
  if (!can(shop, "broadcasts")) {
    return { ok: false, error: upgradeMessage("broadcasts", "Email broadcasts") };
  }

  const gate = await rateLimit(`test-send:${shop.id}`, 10, 3_600);
  if (!gate.allowed) {
    return { ok: false, error: "That's a lot of test sends — try again later." };
  }

  const { subject, bodyMarkdown } = read(formData);
  if (!subject || !bodyMarkdown) {
    return { ok: false, error: "Write a subject and a body first." };
  }

  const to = shop.contactEmail ?? user.email;
  if (!to) return { ok: false, error: "Add a contact email in settings first." };

  const token = unsubscribeToken({ shopId: shop.id, email: to });
  if (!token) {
    return { ok: false, error: "Email isn't configured on this deployment." };
  }
  const url = unsubscribeUrl(token);
  const t = getDictionary(shop.locale ?? "en");

  const result = await send({
    from: sender(shop.name, ORDERS),
    to,
    subject: `[Test] ${subject}`,
    html: renderBroadcast({
      shop,
      subject,
      bodyMarkdown,
      unsubscribeUrl: url,
      senderLine: shop.location ? `${shop.name} · ${shop.location}` : shop.name,
      unsubscribeLabel: t.unsubscribe.link,
    }),
    text: renderText(bodyMarkdown, url),
  });

  return result.sent
    ? { ok: true, message: `Test sent to ${to}.` }
    : { ok: false, error: `Couldn't send: ${result.reason}` };
}

/** Builds the queue and hands it to the cron. */
export async function sendBroadcast(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  const { shop } = await requireShop();
  if (!can(shop, "broadcasts")) {
    return { ok: false, error: upgradeMessage("broadcasts", "Email broadcasts") };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Which broadcast?" };

  const budget = await budgetFor(shop);
  if (budget.available === 0) {
    return {
      ok: false,
      error:
        budget.limitedBy === "plan"
          ? "You've reached today's sending limit. It resets on a rolling 24 hours."
          : "Sending is paused across Sailo for the next little while. Nothing is lost — try again shortly.",
    };
  }

  const result = await queueBroadcast({ shop, broadcastId: id });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/admin/broadcasts");
  revalidatePath(`/admin/broadcasts/${id}`);

  if (result.queued === 0) {
    return {
      ok: true,
      message:
        "Nobody to send to — this audience has no contacts who opted in to marketing email.",
    };
  }

  return {
    ok: true,
    /*
     * No silent caps: a clamped audience says so. It does not, though, promise
     * "send again to reach the rest" — the audience is the oldest N consented
     * contacts with no offset, so a second send re-mails the same N and never
     * reaches the tail. Saying which N were reached is the truth; a follow-up
     * that reaches the rest needs segmentation this feature does not yet have.
     */
    message: result.clamped
      ? `Sending to your ${result.queued} longest-standing contacts — the most one broadcast can hold. Reaching a larger list needs segmentation; contact support if you need it.`
      : `Sending to ${result.queued} ${result.queued === 1 ? "person" : "people"}. It goes out over the next few minutes.`,
  };
}

/** Deletes a draft. A broadcast that has been sent is a record and stays. */
export async function deleteBroadcast(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");

  await getDb()
    .delete(broadcasts)
    .where(
      and(
        eq(broadcasts.id, id),
        eq(broadcasts.shopId, shop.id),
        eq(broadcasts.status, "draft"),
      ),
    );

  revalidatePath("/admin/broadcasts");
  redirect("/admin/broadcasts");
}
