"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { normalizeTags, MAX_TAGS } from "@sailo/core/tags";
import { normalizePhone } from "@sailo/core/phone";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { emitContactWebhook } from "@sailo/webhooks/emit";
import { announceContactUpdated } from "@sailo/marketing/contacts/server";

/** Editing the people in a shop's list, by hand. */

export type ClientActionState = { ok: boolean; error?: string; message?: string };

/**
 * Replaces a client's tags.
 *
 * Scoped by `requireShop()`'s id in the WHERE and not by the client id alone.
 * A client id is a value the form supplies, so a matcher that trusts it lets
 * any signed-in seller retag any customer on the platform — the plainest
 * IDOR there is, and the reason the shop id is in the same statement rather
 * than checked in a branch above it.
 */
export async function setClientTags(
  _prev: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  const { shop } = await requireShop();

  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) return { ok: false, error: "Which customer?" };

  const { tags, truncated } = normalizeTags(String(formData.get("tags") ?? ""));

  const [updated] = await getDb()
    .update(clients)
    .set({ tags, updatedAt: new Date() })
    .where(and(eq(clients.id, clientId), eq(clients.shopId, shop.id)))
    .returning({ id: clients.id });

  // Nothing came back means the row is not this shop's, which is the same
  // answer as "no such customer" — never an existence oracle.
  if (!updated) return { ok: false, error: "That customer isn't in your list." };

  revalidatePath("/admin/clients");
  revalidatePath(`/admin/clients/${clientId}`);

  /*
   * `contact.updated` — spec 30's third trigger. Tags are the field a segment
   * is most often written against, so a flow watching them is the common case.
   *
   * Deferred with `after`, unlike the custom-field path: the seller is holding
   * a tag editor and an enrolment they cannot see must not sit between them
   * and the row being saved.
   */
  after(() => announceContactUpdated(shop.id, clientId, ["tags"]));

  return {
    ok: true,
    // No silent caps: the seller is told the twenty-first tag was dropped.
    message: truncated ? `Saved — kept the first ${MAX_TAGS} tags.` : "Saved.",
  };
}

/**
 * Adds one contact by hand.
 *
 * Consent is not a field here, and that is the whole design. A seller typing
 * somebody in cannot attest that that person agreed to marketing email —
 * only the checkout box can, because only it was ticked by the person
 * themselves. So a manual contact lands with `marketingConsentAt` null and
 * broadcasts will not reach them, and the form says so rather than letting
 * the seller find out when the send count is smaller than the list.
 */
export async function addClient(
  _prev: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  const { shop } = await requireShop();

  const gate = await rateLimit(`add-client:${await callerIp()}`, 60, 300);
  if (!gate.allowed) {
    return { ok: false, error: "Slow down a moment, then try again." };
  }

  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const emailRaw = String(formData.get("email") ?? "").trim().toLowerCase();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const phone = phoneRaw ? normalizePhone(phoneRaw) || null : null;

  const email = emailRaw || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }
  if (!email && !phone) {
    return { ok: false, error: "Add an email address or a phone number." };
  }

  const { tags } = normalizeTags(String(formData.get("tags") ?? ""));
  const note = String(formData.get("notes") ?? "").trim().slice(0, 2000) || null;

  /*
   * `onConflictDoNothing` covers both unique indexes — (shop, email) and
   * (shop, phone) — where a targeted upsert could only cover one. An empty
   * result is a contact the shop already has, which is worth saying plainly
   * rather than reporting as a failure.
   */
  const [created] = await getDb()
    .insert(clients)
    .values({
      shopId: shop.id,
      name: name || email || phone || "Contact",
      email,
      phone,
      tags,
      notes: note,
      source: "manual",
      // Stated, not defaulted: this column is the one thing on the row that
      // a seller must never be able to set on someone else's behalf.
      marketingConsentAt: null,
    })
    .onConflictDoNothing()
    .returning({ id: clients.id });

  revalidatePath("/admin/clients");

  /*
   * Only on a genuine insert. `onConflictDoNothing` returning nothing means
   * the shop already had this person, and a `contact.created` for somebody
   * who has been a customer for a year is how a mailing list gets a welcome
   * sequence sent to people who already finished it.
   */
  if (created) {
    const clientId = created.id;
    after(() => emitContactWebhook({ shop, clientId }));
  }

  return created
    ? { ok: true, message: "Contact added." }
    : { ok: false, error: "You already have someone with those details." };
}
