"use server";

import { revalidatePath } from "next/cache";
import { requireShop } from "@/lib/session";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { revalidateShop } from "@/lib/cache";
import { can } from "@sailo/core/plans";
import {
  createField,
  createList,
  deleteField,
  deleteList,
  joinList,
  leaveList,
  resubscribe,
  updateField,
  updateList,
} from "@sailo/marketing/contacts/server";
import { isMemberSource } from "@sailo/marketing/contacts";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, contactLists, type Shop } from "@sailo/db/schema";
import { getDictionary, interpolate } from "@sailo/i18n";
import { sendSubscribeConfirmation } from "@sailo/email/lifecycle";
import {
  listConfirmToken,
  listConfirmUrl,
} from "@sailo/marketing/contacts/server";

/**
 * The seller's own edits to their audience: lists, fields, and the one button
 * that lifts a suppression.
 *
 * Every one of these is scoped by `requireShop()`'s id, and the id goes into
 * the statement rather than into a branch above it — a list id or a field id
 * is a value the form supplies, and a matcher that trusts it lets any
 * signed-in seller edit any shop's rows.
 */

export type AudienceActionState = { ok: boolean; error?: string; message?: string };

const OK = (message: string): AudienceActionState => ({ ok: true, message });
const NO = (error: string): AudienceActionState => ({ ok: false, error });

/**
 * The gate on every write here.
 *
 * `broadcasts` is the Business feature and this is not it: an audience, its
 * lists and its custom fields are a CRM, and a seller building one before they
 * can send to it is a seller doing the right thing in the right order. Gated on
 * Pro, which is where `csvExport` already sits — the tier that buys "your shop
 * looks like your own" is the tier where a seller starts keeping records.
 */
function gated(shop: Parameters<typeof can>[0]): boolean {
  return can(shop, "csvExport");
}

const UPGRADE = "Lists and custom fields are on the Pro plan.";

/* --------------------------------------------------------------------------
   Lists
-------------------------------------------------------------------------- */

export async function createContactList(
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const { shop } = await requireShop();
  if (!gated(shop)) return NO(UPGRADE);

  const result = await createList(shop.id, {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    /*
     * Absent means on. A checkbox that is not ticked submits nothing at all,
     * and reading that as "double opt-in off" would turn the safe default into
     * whatever the browser happened to send — including for a request that
     * never rendered the box.
     */
    doubleOptIn: formData.get("doubleOptIn") !== "off",
  });

  if (!result.ok) {
    if (result.reason === "name") return NO("Give the list a name.");
    if (result.reason === "limit") return NO("That's as many lists as one shop can keep.");
    // Safe to say here in a way it would not be on a public form: these are
    // the seller's own list names, in their own shop.
    return NO("You already have a list with that name.");
  }

  revalidatePath("/admin/broadcasts/lists");
  return OK("List created.");
}

export async function updateContactList(
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const { shop } = await requireShop();
  if (!gated(shop)) return NO(UPGRADE);

  const listId = String(formData.get("listId") ?? "");
  if (!listId) return NO("Which list?");

  const ok = await updateList(shop.id, listId, {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    doubleOptIn: formData.get("doubleOptIn") !== "off",
  });
  // Nothing came back means the row is not this shop's, which is the same
  // answer as "no such list" — never an existence oracle.
  if (!ok) return NO("That list isn't yours.");

  revalidatePath("/admin/broadcasts/lists");
  return OK("Saved.");
}

export async function deleteContactList(
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const { shop } = await requireShop();
  if (!gated(shop)) return NO(UPGRADE);

  const listId = String(formData.get("listId") ?? "");
  if (!listId) return NO("Which list?");
  if (!(await deleteList(shop.id, listId))) return NO("That list isn't yours.");

  revalidatePath("/admin/broadcasts/lists");
  /*
   * Said plainly, because the seller has just been shown a confirm dialog and
   * the thing they are most likely to fear is the thing that did not happen.
   * Deleting a list ends a grouping; it does not unsubscribe anybody.
   */
  return OK("List deleted. Nobody was unsubscribed.");
}

export async function addToContactList(
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const { shop } = await requireShop();
  if (!gated(shop)) return NO(UPGRADE);

  const listId = String(formData.get("listId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  if (!listId || !clientId) return NO("Which contact, and which list?");

  const rawSource = String(formData.get("source") ?? "manual");
  const source = isMemberSource(rawSource) ? rawSource : "manual";

  const outcome = await joinList({ shopId: shop.id, listId, clientId, source });
  if (!outcome) return NO("That contact or list isn't yours.");

  /*
   * A `pending` member with no email is a dead end, and a list that silently
   * never reaches half the people on it is worse than one that never asked.
   * Rule 6 is only real once this send exists.
   *
   * Awaited rather than fired into `after()`: the seller is looking at the
   * answer, and "added — they'll confirm by email" is a claim about a message
   * that has to have been handed to the transport before it is made.
   */
  if (outcome.status === "pending") {
    const invited = await inviteToList({ shop, listId, clientId });
    if (!invited) {
      return NO(
        "Added, but the confirmation email couldn't be sent — so they won't " +
          "receive anything yet. Try again in a moment.",
      );
    }
  }

  revalidatePath("/admin/broadcasts/lists");
  revalidatePath(`/admin/clients/${clientId}`);

  /*
   * The `pending` answer is not a failure and must not read like one — but it
   * must also not read like a success that will send mail, because it will not
   * until somebody clicks a link in their own inbox.
   */
  return OK(
    outcome.status === "pending"
      ? "Added — they'll be on the list once they confirm by email."
      : "Added to the list.",
  );
}


/**
 * Sends the double-opt-in email for one list join.
 *
 * Reuses `sendSubscribeConfirmation` — the same message, the same markup, the
 * same "if you did not ask for this, ignore it" copy — with the list's own
 * confirmation link. A second confirmation email would be a second place to
 * get that copy wrong, and it is the one message in the product sent to
 * somebody who has consented to nothing.
 *
 * Returns false rather than throwing on every "cannot": no address to send to,
 * no signing secret, no transport. The caller says so; an optimistic "check
 * your inbox" for a message that was never sent leaves somebody waiting.
 */
async function inviteToList(opts: {
  shop: Shop;
  listId: string;
  clientId: string;
}): Promise<boolean> {
  const [client, list] = await Promise.all([
    getDb().query.clients.findFirst({
      where: and(eq(clients.id, opts.clientId), eq(clients.shopId, opts.shop.id)),
      columns: { email: true, name: true },
    }),
    getDb().query.contactLists.findFirst({
      where: and(eq(contactLists.id, opts.listId), eq(contactLists.shopId, opts.shop.id)),
      columns: { id: true },
    }),
  ]);
  // A contact with no address cannot be asked to confirm by email. `joinList`
  // only returns `pending` for one that has consent missing, and a phone-only
  // contact reaches this — so it is a real case, not a defensive branch.
  if (!client?.email || !list) return false;

  const token = listConfirmToken({
    shopId: opts.shop.id,
    listId: list.id,
    email: client.email.toLowerCase(),
    name: client.name,
  });
  // No signing secret means no confirmable link, and an unconfirmable
  // invitation either does nothing or subscribes somebody who never proved
  // the address was theirs.
  if (!token) return false;

  const dict = getDictionary(opts.shop.locale);
  const result = await sendSubscribeConfirmation({
    shop: opts.shop,
    to: client.email,
    name: client.name,
    confirmUrl: listConfirmUrl(token),
    labels: {
      subject: interpolate(dict.mailing.confirmSubject, { shop: opts.shop.name }),
      title: dict.mailing.confirmTitle,
      body: interpolate(dict.mailing.confirmEmailBody, { shop: opts.shop.name }),
      cta: dict.mailing.confirmCta,
    },
  });
  return result.sent;
}

export async function removeFromContactList(
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const { shop } = await requireShop();
  if (!gated(shop)) return NO(UPGRADE);

  const listId = String(formData.get("listId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  if (!listId || !clientId) return NO("Which contact, and which list?");

  if (!(await leaveList({ shopId: shop.id, listId, clientId }))) {
    return NO("They're not on that list.");
  }

  revalidatePath("/admin/broadcasts/lists");
  revalidatePath(`/admin/clients/${clientId}`);
  // Rule 2, in the sentence the seller reads. Removal is one list; unsubscribe
  // is every list this shop has and every one it will make.
  return OK("Removed from this list. They're still on your other lists.");
}

/* --------------------------------------------------------------------------
   Custom fields
-------------------------------------------------------------------------- */

/** The options textarea, one per line — the shape a seller pastes. */
function optionLines(formData: FormData): string[] {
  return String(formData.get("options") ?? "").split("\n");
}

export async function createContactField(
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const { shop } = await requireShop();
  if (!gated(shop)) return NO(UPGRADE);

  const result = await createField(shop.id, {
    key: String(formData.get("key") ?? ""),
    label: String(formData.get("label") ?? ""),
    type: String(formData.get("type") ?? "text"),
    options: optionLines(formData),
    required: formData.get("required") === "on",
    scope: String(formData.get("scope") ?? "contact"),
  });

  if (!result.ok) {
    switch (result.reason) {
      case "key":
        return NO("Give the field a name to store it under.");
      case "keyShape":
        return NO("Use lower-case letters, numbers and underscores — it can't start with a number.");
      case "keyReserved":
        return NO("That name is already one of the contact's own. Pick another.");
      case "label":
        return NO("Give the field a label buyers will read.");
      case "type":
        return NO("Pick a type, and give a dropdown at least one option.");
      case "limit":
        return NO("That's as many fields as one shop can define.");
      default:
        return NO("You already have a field stored under that name.");
    }
  }

  /*
   * Two revalidations, and the second is the one that matters. The screen path
   * is the seller's own view; `revalidateShop` bumps the tag the *storefront's*
   * cached checkout options ride on, so without it a new question would not be
   * asked until that entry expired on its own.
   */
  revalidatePath("/admin/settings/fields");
  revalidateShop(shop.id, shop.handle);
  return OK("Field created.");
}

export async function updateContactField(
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const { shop } = await requireShop();
  if (!gated(shop)) return NO(UPGRADE);

  const fieldId = String(formData.get("fieldId") ?? "");
  if (!fieldId) return NO("Which field?");

  const ok = await updateField(shop.id, fieldId, {
    label: String(formData.get("label") ?? ""),
    type: String(formData.get("type") ?? "text"),
    options: optionLines(formData),
    required: formData.get("required") === "on",
    scope: String(formData.get("scope") ?? "contact"),
  });
  if (!ok) return NO("That field isn't yours.");

  revalidatePath("/admin/settings/fields");
  revalidateShop(shop.id, shop.handle);
  return OK("Saved.");
}

export async function deleteContactField(
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const { shop } = await requireShop();
  if (!gated(shop)) return NO(UPGRADE);

  const fieldId = String(formData.get("fieldId") ?? "");
  if (!fieldId) return NO("Which field?");
  if (!(await deleteField(shop.id, fieldId))) return NO("That field isn't yours.");

  revalidatePath("/admin/settings/fields");
  revalidateShop(shop.id, shop.handle);
  // The reassurance that matters: past orders keep what they were told.
  return OK("Field deleted. Past orders keep the answers they recorded.");
}

/* --------------------------------------------------------------------------
   Suppressions
-------------------------------------------------------------------------- */

/**
 * Puts an address back on the list, if it left by choice.
 *
 * Rate-limited despite being behind a session, because it is the one action in
 * this file that undoes a promise made to somebody who is not the seller. The
 * ceiling is not a security boundary — `requireShop` is — but a seller
 * scripting this against a bought list would be doing it one address at a
 * time, and a ceiling is what makes that visible rather than free.
 */
export async function resubscribeAddress(
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const { shop } = await requireShop();
  if (!gated(shop)) return NO(UPGRADE);

  const gate = await rateLimit(`resubscribe:${await callerIp()}`, 30, 300);
  if (!gate.allowed) return NO("Slow down a moment, then try again.");

  const email = String(formData.get("email") ?? "");
  if (!email) return NO("Which address?");

  const outcome = await resubscribe(shop.id, email);
  revalidatePath("/admin/broadcasts/unsubscribed");

  switch (outcome) {
    case "lifted":
      /*
       * Deliberately not "they'll receive your next campaign". Lifting a
       * suppression restores an address to *mailable if consented*; somebody
       * who never gave consent still receives nothing, and a message that
       * promised otherwise would be the seller's first surprise.
       */
      return OK("Unsubscribe lifted. They'll receive mail again once they've opted in.");
    case "refused":
      // Rule 8's hard half, said as the reason rather than as a refusal.
      return NO(
        "That address bounced or reported spam. It can't be switched back on — " +
          "sending to it again costs every seller on this domain.",
      );
    default:
      return NO("That address isn't on your suppression list.");
  }
}
