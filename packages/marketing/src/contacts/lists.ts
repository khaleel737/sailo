import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  contactFieldValues,
  contactListMembers,
  contactLists,
} from "@sailo/db/schema";
import { enrolIfMatching } from "../automations/enrol";
import {
  MAX_LIST_DESCRIPTION_LENGTH,
  MAX_LIST_NAME_LENGTH,
  MAX_LISTS_PER_SHOP,
  type MemberSource,
} from "./membership";

/**
 * Lists, and joining one.
 *
 * The eight rules of spec 34 are the correctness floor for everything in this
 * release that sends mail, and four of them are decided in this file. Each is
 * named where it is implemented rather than summarised here, because a rule
 * restated at the top of a file is a rule that can be true at the top and
 * false at the bottom.
 *
 * What this file deliberately does **not** do is check suppression. Rule 1
 * says adding a suppressed address writes the row and the address still
 * receives nothing — so the write is unconditional and the *send* is what
 * refuses. Putting the check here would look kinder and would be a lie: the
 * seller would see the add fail and have no idea why, and the moment somebody
 * later removed the check from the send path there would be nothing left.
 */

export type ContactList = {
  id: string;
  name: string;
  description: string | null;
  doubleOptIn: boolean;
  createdAt: Date;
  /** Members who would receive a send today: `subscribed`, nothing else. */
  subscribedCount: number;
  /** Waiting on a click in their own inbox. Not recipients. */
  pendingCount: number;
};

/* --------------------------------------------------------------------------
   The lists themselves
-------------------------------------------------------------------------- */

/**
 * Every list this shop has, with the two counts a seller reads them by.
 *
 * One statement with filtered counts rather than a query per list, and a left
 * join so a list nobody has joined yet reports zero rather than vanishing —
 * the empty list is the one a seller has just made and is looking for.
 */
export async function listsFor(shopId: string): Promise<ContactList[]> {
  const rows = await getDb()
    .select({
      id: contactLists.id,
      name: contactLists.name,
      description: contactLists.description,
      doubleOptIn: contactLists.doubleOptIn,
      createdAt: contactLists.createdAt,
      subscribedCount: sql<string>`count(*) filter (where ${contactListMembers.status} = 'subscribed')`,
      pendingCount: sql<string>`count(*) filter (where ${contactListMembers.status} = 'pending')`,
    })
    .from(contactLists)
    .leftJoin(contactListMembers, eq(contactListMembers.listId, contactLists.id))
    .where(eq(contactLists.shopId, shopId))
    .groupBy(contactLists.id)
    .orderBy(desc(contactLists.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    doubleOptIn: row.doubleOptIn,
    createdAt: row.createdAt,
    subscribedCount: Number(row.subscribedCount ?? 0),
    pendingCount: Number(row.pendingCount ?? 0),
  }));
}

export type CreateListOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "name" | "duplicate" | "limit" };

/**
 * A new list.
 *
 * The duplicate answer is `duplicate` and not silence, and that is safe here
 * in a way it would not be on a public form: this is the seller's own shop and
 * their own list names, so telling them the name is taken reveals nothing they
 * do not already own. The unique index is folded, so "VIPs" collides with
 * "vips" — which is the point, and the message has to say so or the seller
 * retypes the same name in a different case.
 */
export async function createList(
  shopId: string,
  input: { name: string; description?: string | null; doubleOptIn?: boolean },
): Promise<CreateListOutcome> {
  const name = input.name.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_LIST_NAME_LENGTH);
  if (!name) return { ok: false, reason: "name" };

  const [{ n } = { n: "0" }] = await getDb()
    .select({ n: sql<string>`count(*)` })
    .from(contactLists)
    .where(eq(contactLists.shopId, shopId));
  if (Number(n) >= MAX_LISTS_PER_SHOP) return { ok: false, reason: "limit" };

  const [created] = await getDb()
    .insert(contactLists)
    .values({
      shopId,
      name,
      description:
        input.description?.trim().slice(0, MAX_LIST_DESCRIPTION_LENGTH) || null,
      doubleOptIn: input.doubleOptIn ?? true,
    })
    .onConflictDoNothing()
    .returning({ id: contactLists.id });

  return created ? { ok: true, id: created.id } : { ok: false, reason: "duplicate" };
}

/**
 * Renames a list, or changes its opt-in rule.
 *
 * Scoped by the shop id in the WHERE rather than by the list id alone. A list
 * id is a value a form supplies, and a matcher that trusts it lets any
 * signed-in seller rename any list on the platform.
 */
export async function updateList(
  shopId: string,
  listId: string,
  input: { name?: string; description?: string | null; doubleOptIn?: boolean },
): Promise<boolean> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = input.name.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_LIST_NAME_LENGTH);
    if (!name) return false;
    patch.name = name;
  }
  if (input.description !== undefined) {
    patch.description =
      input.description?.trim().slice(0, MAX_LIST_DESCRIPTION_LENGTH) || null;
  }
  if (input.doubleOptIn !== undefined) patch.doubleOptIn = input.doubleOptIn;

  const [updated] = await getDb()
    .update(contactLists)
    .set(patch)
    .where(and(eq(contactLists.id, listId), eq(contactLists.shopId, shopId)))
    .returning({ id: contactLists.id });
  return Boolean(updated);
}

/**
 * Deletes a list and its membership rows.
 *
 * Deliberately not a suppression, and this is rule 2 at its sharpest: deleting
 * a list ends a grouping, it does not end a relationship. Everybody who was on
 * it remains a contact, remains consented if they were, and remains
 * unsubscribed if they were — none of which this statement touches.
 */
export async function deleteList(shopId: string, listId: string): Promise<boolean> {
  const [deleted] = await getDb()
    .delete(contactLists)
    .where(and(eq(contactLists.id, listId), eq(contactLists.shopId, shopId)))
    .returning({ id: contactLists.id });
  return Boolean(deleted);
}

/* --------------------------------------------------------------------------
   Joining and leaving
-------------------------------------------------------------------------- */

export type JoinOutcome = {
  /** What the member row now says. `pending` means a link has to be clicked. */
  status: "subscribed" | "pending";
  /** False when they were already on this list in this state. */
  changed: boolean;
};

/**
 * Puts a contact on a list.
 *
 * **Rule 1 — a list write never resurrects an unsubscribe.** There is no
 * suppression check here on purpose; see the file header.
 *
 * **Rule 5 — adding an existing address updates rather than duplicates.** The
 * primary key is `(list, client)`, so a second add is an `ON CONFLICT` update
 * and never a second row. It also means re-adding somebody who was `removed`
 * puts them back, which is what a seller means by adding them again.
 *
 * **Rule 6 — double opt-in per list.** A list that asks for it admits members
 * as `pending`, and a `pending` member is not a recipient. The one exception
 * is a contact who already carries `marketingConsentAt` for this shop: they
 * have already clicked a link in their own inbox for this seller, and asking
 * again is ceremony that costs a real join. `force` is how an import onto a
 * single-opt-in list skips it — the seller's claim, recorded as
 * `source = 'import'` so the audience screen can still say where it came from.
 */
export async function joinList(input: {
  shopId: string;
  listId: string;
  clientId: string;
  source: MemberSource;
  /** Skip the pending state even on a double-opt-in list. Import only. */
  force?: boolean;
  now?: Date;
}): Promise<JoinOutcome | null> {
  const db = getDb();
  const now = input.now ?? new Date();

  /*
   * Both rows loaded in one round trip and both scoped to the shop. The list
   * lookup is the ownership check — a list id from a form that is not this
   * shop's returns nothing, and the join never happens.
   */
  const [list, client] = await Promise.all([
    db.query.contactLists.findFirst({
      where: and(eq(contactLists.id, input.listId), eq(contactLists.shopId, input.shopId)),
      columns: { id: true, doubleOptIn: true },
    }),
    db.query.clients.findFirst({
      where: and(eq(clients.id, input.clientId), eq(clients.shopId, input.shopId)),
      columns: { id: true, email: true, marketingConsentAt: true },
    }),
  ]);
  if (!list || !client) return null;

  const needsConfirmation =
    list.doubleOptIn && !input.force && !client.marketingConsentAt;
  const status = needsConfirmation ? "pending" : "subscribed";

  const [row] = await db
    .insert(contactListMembers)
    .values({
      listId: list.id,
      clientId: client.id,
      email: client.email?.toLowerCase() ?? null,
      status,
      source: input.source,
      joinedAt: now,
    })
    .onConflictDoUpdate({
      target: [contactListMembers.listId, contactListMembers.clientId],
      /*
       * A re-add never demotes. Somebody already `subscribed` who is added
       * again — by an import, or by a seller who forgot — must not drop to
       * `pending` and stop receiving mail they had already agreed to; the
       * `case` keeps the stronger of the two states. `removedAt` is cleared
       * because they are back, and `joinedAt` is not, because the date they
       * first joined is the one an audit asks about.
       */
      set: {
        status: sql`case when ${contactListMembers.status} = 'subscribed' then 'subscribed' else ${status} end`,
        removedAt: null,
        email: client.email?.toLowerCase() ?? null,
      },
    })
    .returning({ status: contactListMembers.status, joinedAt: contactListMembers.joinedAt });

  const settled = row?.status === "subscribed" ? "subscribed" : "pending";
  const changed = row?.joinedAt?.getTime() === now.getTime();

  /*
   * `list.joined`, announced inside the write.
   *
   * Here rather than at the caller, for the reason `broadcasts/subscribe`
   * raises `contact.created` here: an announcement a caller has to remember is
   * an announcement two of the four call sites will forget. It is one of the
   * two deliberate exceptions the workflows package's header records.
   *
   * **Only on a real join, and only when they are actually subscribed.** A
   * re-add that changed nothing must not re-enrol somebody into a welcome
   * sequence they already walked, and a `pending` member has not joined yet —
   * enrolling them would start a flow for an address nobody has confirmed.
   * `confirmMembership` fires it when they do confirm, which is the moment the
   * join becomes true.
   */
  if (changed && settled === "subscribed") {
    await announceListJoin(input.shopId, list.id, client.id, client.email);
  }

  return { status: settled, changed };
}

/**
 * Starts any flow waiting on this list.
 *
 * Swallows everything. A seller adding somebody to a list must see that it
 * worked whatever an automation is doing, and `enrolIfMatching` is not the
 * kind of failure that should undo the membership row that is already
 * written.
 */
async function announceListJoin(
  shopId: string,
  listId: string,
  clientId: string,
  email: string | null,
): Promise<void> {
  if (!email) return;
  try {
    await enrolIfMatching({
      shopId,
      trigger: "list.joined",
      subject: { email: email.toLowerCase(), clientId },
      context: { listId },
    });
  } catch (error) {
    console.error("[sailo] list.joined enrolment failed", error);
  }
}

/**
 * Takes somebody off one list.
 *
 * **Rule 2.** `removed`, not deleted and not suppressed. Deleted would lose
 * the fact that they left and the next import would put them back; suppressed
 * would end every list at once, which is a different verb with a different
 * button. The other lists this person is on are untouched, which is the whole
 * assertion.
 */
export async function leaveList(input: {
  shopId: string;
  listId: string;
  clientId: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const [updated] = await getDb()
    .update(contactListMembers)
    .set({ status: "removed", removedAt: now })
    .where(
      and(
        eq(contactListMembers.listId, input.listId),
        eq(contactListMembers.clientId, input.clientId),
        /*
         * The ownership check, as a correlated EXISTS in the same statement
         * rather than a lookup above it. `contact_list_members` has no
         * `shop_id` of its own — the list is what makes it a shop's — so
         * check-then-act here would be a genuine TOCTOU on a table any
         * signed-in seller can name a row in.
         */
        sql`exists (
          select 1 from ${contactLists}
          where ${contactLists.id} = ${contactListMembers.listId}
            and ${contactLists.shopId} = ${input.shopId}
        )`,
      ),
    )
    .returning({ clientId: contactListMembers.clientId });
  return Boolean(updated);
}

/**
 * Turns a `pending` member into a subscribed one, after the link was clicked.
 *
 * Only ever `pending → subscribed`, never `removed → subscribed`: somebody who
 * left the list and then clicked a months-old confirmation link out of an old
 * email has not asked to come back. The status is in the WHERE rather than
 * read first, so two clicks race to the same row and one of them loses
 * harmlessly.
 */
export async function confirmMembership(input: {
  shopId: string;
  listId: string;
  clientId: string;
}): Promise<boolean> {
  const [updated] = await getDb()
    .update(contactListMembers)
    .set({ status: "subscribed", removedAt: null })
    .where(
      and(
        eq(contactListMembers.listId, input.listId),
        eq(contactListMembers.clientId, input.clientId),
        eq(contactListMembers.status, "pending"),
        sql`exists (
          select 1 from ${contactLists}
          where ${contactLists.id} = ${contactListMembers.listId}
            and ${contactLists.shopId} = ${input.shopId}
        )`,
      ),
    )
    .returning({ clientId: contactListMembers.clientId, email: contactListMembers.email });

  /*
   * The other moment a join becomes true. On a double-opt-in list `joinList`
   * wrote `pending` and announced nothing; this is the click, so the trigger
   * fires here — exactly once per join, from whichever of the two paths
   * actually completed it.
   */
  if (updated) {
    await announceListJoin(input.shopId, input.listId, input.clientId, updated.email);
  }
  return Boolean(updated);
}

/** Which lists one contact is on, and in what state — for the contact card. */
export async function listsForClient(
  shopId: string,
  clientId: string,
): Promise<{ id: string; name: string; status: string; joinedAt: Date }[]> {
  return getDb()
    .select({
      id: contactLists.id,
      name: contactLists.name,
      status: contactListMembers.status,
      joinedAt: contactListMembers.joinedAt,
    })
    .from(contactListMembers)
    .innerJoin(contactLists, eq(contactLists.id, contactListMembers.listId))
    .where(
      and(eq(contactListMembers.clientId, clientId), eq(contactLists.shopId, shopId)),
    )
    .orderBy(contactLists.name);
}

/**
 * Every contact's list names, for one page of the audience table.
 *
 * One statement for the page rather than one per row: the audience screen
 * shows a `lists` column, and asking per row is five hundred queries to render
 * one table.
 */
export async function listNamesByClient(
  shopId: string,
  clientIds: string[],
): Promise<Map<string, string[]>> {
  if (clientIds.length === 0) return new Map();

  const rows = await getDb()
    .select({ clientId: contactListMembers.clientId, name: contactLists.name })
    .from(contactListMembers)
    .innerJoin(contactLists, eq(contactLists.id, contactListMembers.listId))
    .where(
      and(
        inArray(contactListMembers.clientId, clientIds),
        eq(contactLists.shopId, shopId),
        eq(contactListMembers.status, "subscribed"),
      ),
    );

  const out = new Map<string, string[]>();
  for (const row of rows) {
    const names = out.get(row.clientId) ?? [];
    names.push(row.name);
    out.set(row.clientId, names);
  }
  return out;
}

/**
 * Deletes every answer a contact gave, when the seller deletes the contact.
 *
 * Not needed for correctness — both foreign keys cascade — and exported
 * because the CSV export and the data-request sweep need to be able to say
 * what would go, not only to watch it go.
 */
export async function fieldValueCountFor(clientId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<string>`count(*)` })
    .from(contactFieldValues)
    .where(eq(contactFieldValues.clientId, clientId));
  return Number(row?.n ?? 0);
}
