import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  contactFieldValues,
  contactListMembers,
  contactLists,
  emailSuppressions,
  shops,
  user,
} from "@sailo/db/schema";
import { audienceFor, audienceSize, suppress } from "@sailo/marketing/broadcasts/server";
import {
  confirmMembership,
  createField,
  createList,
  deleteField,
  joinList,
  leaveList,
  resubscribe,
  saveAnswers,
} from "@sailo/marketing/contacts/server";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";

/**
 * The eight rules of spec 34, against real rows.
 *
 * `packages/marketing/src/contacts/rules.test.ts` proves the *mechanism* — it
 * renders the WHERE clause and asserts that consent, suppression and list
 * status are all inside it. This proves the *behaviour*, which is a different
 * claim and the one a seller experiences: that adding a suppressed address
 * really does mail nobody, that one contact on three lists really is one
 * recipient, that a `pending` member really is skipped.
 *
 * Neither replaces the other. A unit test that mocked the database could pass
 * against a schema that does not exist, and a scenario alone would go green
 * the day somebody moved the consent check out of the query and into a filter
 * that this fixture's data happens not to exercise.
 *
 * Run with:
 *   npx dotenv -e .env.local.test -- \
 *     npx vitest run --config vitest.scenarios.mts e2e/scenarios/audience.scenario.ts
 */

const db = getDb();
const uid = () => crypto.randomUUID();

const PREFIX = "sc-audience-";

let shopId: string;

async function makeShop(): Promise<string> {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Audience Fixture",
    email: `${PREFIX}${userId}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      name: "Audience Fixture",
      handle: `${PREFIX}${uid().slice(0, 8)}`,
      currency: "USD",
    })
    .returning({ id: shops.id });
  return shop!.id;
}

/** A consented contact, which is what `audienceFor` will actually return. */
async function makeContact(email: string, opts: { consented?: boolean } = {}) {
  const [row] = await db
    .insert(clients)
    .values({
      shopId,
      name: email.split("@")[0]!,
      email,
      source: "subscribe",
      marketingConsentAt: opts.consented === false ? null : new Date(),
    })
    .returning({ id: clients.id });
  return row!.id;
}

/** A contact reachable only on a chat rail — the amended identity's whole point. */
async function makePhoneContact(phone: string) {
  const [row] = await db
    .insert(clients)
    .values({
      shopId,
      name: "WhatsApp buyer",
      email: null,
      phone,
      source: "order",
      marketingConsentAt: new Date(),
    })
    .returning({ id: clients.id });
  return row!.id;
}

async function makeList(name: string, doubleOptIn = false) {
  const result = await createList(shopId, { name, doubleOptIn });
  if (!result.ok) throw new Error(`list ${name}: ${result.reason}`);
  return result.id;
}

/** Who a send to these lists would actually reach, as addresses. */
async function reach(listIds: string[]): Promise<string[]> {
  const { recipients } = await audienceFor(shopId, { listIds });
  return recipients.map((r) => r.email).toSorted();
}

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures([PREFIX]);
});

beforeEach(async () => {
  shopId = await makeShop();
});

describe("rule 1 — adding to a list does not resurrect a past unsubscribe", () => {
  it("writes the member row and still mails nobody", async () => {
    const email = `${PREFIX}gone@example.com`;
    const clientId = await makeContact(email);
    const listId = await makeList("Regulars");

    await suppress({ shopId, email, reason: "unsubscribed" });
    const outcome = await joinList({ shopId, listId, clientId, source: "manual" });

    // The row exists — the seller's action was not silently dropped …
    expect(outcome?.status).toBe("subscribed");
    const rows = await db
      .select()
      .from(contactListMembers)
      .where(eq(contactListMembers.listId, listId));
    expect(rows).toHaveLength(1);

    // … and the address is still unreachable.
    expect(await reach([listId])).toEqual([]);
  });
});

describe("rule 2 — remove from list is not unsubscribe", () => {
  it("leaves the other lists intact and writes no suppression", async () => {
    const email = `${PREFIX}two@example.com`;
    const clientId = await makeContact(email);
    const regulars = await makeList("Regulars");
    const wholesale = await makeList("Wholesale");

    await joinList({ shopId, listId: regulars, clientId, source: "manual" });
    await joinList({ shopId, listId: wholesale, clientId, source: "manual" });
    expect(await leaveList({ shopId, listId: regulars, clientId })).toBe(true);

    expect(await reach([regulars])).toEqual([]);
    expect(await reach([wholesale])).toEqual([email]);

    // The distinction the whole rule is about: no suppression was written.
    const suppressed = await db
      .select()
      .from(emailSuppressions)
      .where(and(eq(emailSuppressions.shopId, shopId), eq(emailSuppressions.email, email)));
    expect(suppressed).toEqual([]);
  });

  it("keeps the removed member as a row rather than deleting it", async () => {
    // A seller who cannot see that somebody left will re-import them.
    const clientId = await makeContact(`${PREFIX}left@example.com`);
    const listId = await makeList("Regulars");
    await joinList({ shopId, listId, clientId, source: "manual" });
    await leaveList({ shopId, listId, clientId });

    const [row] = await db
      .select()
      .from(contactListMembers)
      .where(eq(contactListMembers.listId, listId));
    expect(row?.status).toBe("removed");
    expect(row?.removedAt).not.toBeNull();
  });
});

describe("rule 3 — the audience minus suppression minus no-consent", () => {
  it("excludes a list member who never consented", async () => {
    const listId = await makeList("Regulars");
    const yes = `${PREFIX}yes@example.com`;
    const no = `${PREFIX}no@example.com`;

    await joinList({
      shopId,
      listId,
      clientId: await makeContact(yes),
      source: "manual",
    });
    await joinList({
      shopId,
      listId,
      clientId: await makeContact(no, { consented: false }),
      source: "manual",
    });

    expect(await reach([listId])).toEqual([yes]);
    // And the count agrees with the list, which is the thing a seller reads
    // before pressing Send.
    expect(await audienceSize(shopId, { listIds: [listId] })).toBe(1);
  });
});

describe("rule 4 — one person, one email per campaign, even on three lists", () => {
  it("returns one recipient for a contact on three lists", async () => {
    const email = `${PREFIX}three@example.com`;
    const clientId = await makeContact(email);
    const lists = [
      await makeList("One"),
      await makeList("Two"),
      await makeList("Three"),
    ];
    for (const listId of lists) {
      await joinList({ shopId, listId, clientId, source: "manual" });
    }

    const { recipients } = await audienceFor(shopId, { listIds: lists });
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.email).toBe(email);
    expect(await audienceSize(shopId, { listIds: lists })).toBe(1);
  });

  it("counts two case-variant rows at one address once", async () => {
    /*
     * `clients_shop_email_key` indexes the address as stored, so these are two
     * legal rows and one mailbox. Without the `DISTINCT ON (lower(email))` in
     * `audienceFor` this person receives the campaign twice.
     */
    const listId = await makeList("Regulars");
    const lower = `${PREFIX}case@example.com`;
    const upper = `${PREFIX}CASE@example.com`;
    await joinList({ shopId, listId, clientId: await makeContact(lower), source: "manual" });
    await joinList({ shopId, listId, clientId: await makeContact(upper), source: "manual" });

    const { recipients } = await audienceFor(shopId, { listIds: [listId] });
    expect(recipients).toHaveLength(1);
    expect(await audienceSize(shopId, { listIds: [listId] })).toBe(1);
  });
});

describe("rule 5 — adding an existing address updates rather than duplicates", () => {
  it("does not write a second member row, and puts a removed member back", async () => {
    const clientId = await makeContact(`${PREFIX}again@example.com`);
    const listId = await makeList("Regulars");

    await joinList({ shopId, listId, clientId, source: "signup" });
    await leaveList({ shopId, listId, clientId });
    await joinList({ shopId, listId, clientId, source: "manual" });

    const rows = await db
      .select()
      .from(contactListMembers)
      .where(eq(contactListMembers.listId, listId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("subscribed");
    expect(rows[0]?.removedAt).toBeNull();
  });

  it("blank standard fields overwrite; blank custom fields do not", async () => {
    /*
     * Their import gotcha, and the reason `saveAnswers` takes a mode. Under
     * `skipBlank` an empty column leaves the existing answer alone; without it
     * an empty box means the seller cleared it.
     */
    const clientId = await makeContact(`${PREFIX}blank@example.com`);
    const field = await createField(shopId, {
      key: "size",
      label: "Size",
      type: "text",
    });
    if (!field.ok) throw new Error(field.reason);

    await saveAnswers({ shopId, clientId, answers: [{ key: "size", raw: "Large" }] });

    // An import with an empty column: the answer stands.
    await saveAnswers({
      shopId,
      clientId,
      answers: [{ key: "size", raw: "" }],
      skipBlank: true,
    });
    let [row] = await db
      .select()
      .from(contactFieldValues)
      .where(eq(contactFieldValues.clientId, clientId));
    expect(row?.value).toBe("Large");

    // The seller clearing the box on the contact card: it clears.
    await saveAnswers({ shopId, clientId, answers: [{ key: "size", raw: "" }] });
    [row] = await db
      .select()
      .from(contactFieldValues)
      .where(eq(contactFieldValues.clientId, clientId));
    expect(row?.value).toBeNull();
  });
});

describe("rule 6 — double opt-in per list", () => {
  it("admits as pending, mails nobody, and becomes a recipient on confirm", async () => {
    const email = `${PREFIX}pending@example.com`;
    /*
     * Consent is what `joinList` looks at to decide whether to ask again, so
     * this contact deliberately has none — somebody who already clicked a link
     * in their own inbox for this shop is not asked twice.
     */
    const clientId = await makeContact(email, { consented: false });
    const listId = await makeList("Confirmed", true);

    const joined = await joinList({ shopId, listId, clientId, source: "signup" });
    expect(joined?.status).toBe("pending");
    expect(await reach([listId])).toEqual([]);

    // The click. Consent lands separately — this only promotes the membership,
    // so the audience is still empty until the contact is consented too.
    expect(await confirmMembership({ shopId, listId, clientId })).toBe(true);
    await db
      .update(clients)
      .set({ marketingConsentAt: new Date() })
      .where(eq(clients.id, clientId));

    expect(await reach([listId])).toEqual([email]);
  });

  it("does not demote an already-subscribed member on a re-add", async () => {
    const email = `${PREFIX}stay@example.com`;
    const clientId = await makeContact(email, { consented: false });
    const listId = await makeList("Confirmed", true);

    await joinList({ shopId, listId, clientId, source: "manual", force: true });
    await joinList({ shopId, listId, clientId, source: "import" });

    const [row] = await db
      .select()
      .from(contactListMembers)
      .where(eq(contactListMembers.listId, listId));
    expect(row?.status).toBe("subscribed");
  });
});

describe("rule 7 — custom fields are per-shop and typed", () => {
  it("refuses a dropdown answer that is not one of the options", async () => {
    const clientId = await makeContact(`${PREFIX}drop@example.com`);
    const field = await createField(shopId, {
      key: "size",
      label: "Size",
      type: "dropdown",
      options: ["Small", "Large"],
    });
    if (!field.ok) throw new Error(field.reason);

    const result = await saveAnswers({
      shopId,
      clientId,
      answers: [{ key: "size", raw: "=cmd|'/c calc'!A1" }],
    });
    expect(result.refused).toEqual([{ key: "size", problem: "option" }]);
    expect(result.written).toEqual([]);

    const rows = await db
      .select()
      .from(contactFieldValues)
      .where(eq(contactFieldValues.clientId, clientId));
    expect(rows).toEqual([]);
  });

  it("refuses an order that leaves a required checkout field empty", async () => {
    // Driven from the definitions, so omitting the key entirely is refused —
    // not only an empty value for a key that happened to be sent.
    const clientId = await makeContact(`${PREFIX}req@example.com`);
    const field = await createField(shopId, {
      key: "engraving",
      label: "Engraving",
      type: "text",
      required: true,
      scope: "checkout",
    });
    if (!field.ok) throw new Error(field.reason);

    const result = await saveAnswers({
      shopId,
      clientId,
      answers: [],
      scope: "checkout",
    });
    expect(result.refused).toEqual([{ key: "engraving", problem: "required" }]);
  });

  it("keeps a checkout answer after the field is deleted", async () => {
    /*
     * The whole reason `orders.custom_fields` is a snapshot. Here the snapshot
     * is what `saveAnswers` returned — the same value the order row stores —
     * and it survives the field and its rows cascading away.
     */
    const clientId = await makeContact(`${PREFIX}snap@example.com`);
    const field = await createField(shopId, {
      key: "engraving",
      label: "Engraving",
      type: "text",
      scope: "both",
    });
    if (!field.ok) throw new Error(field.reason);

    const { written } = await saveAnswers({
      shopId,
      clientId,
      answers: [{ key: "engraving", raw: "For Ada" }],
      scope: "checkout",
    });
    expect(written).toEqual([
      { key: "engraving", label: "Engraving", type: "text", value: "For Ada" },
    ]);

    expect(await deleteField(shopId, field.id)).toBe(true);
    const rows = await db
      .select()
      .from(contactFieldValues)
      .where(eq(contactFieldValues.clientId, clientId));
    expect(rows).toEqual([]);
    // The order's copy is untouched, because it was never a join.
    expect(written[0]?.value).toBe("For Ada");
  });
});

describe("rule 8 — account-level opt-out is absolute", () => {
  it("lifts an unsubscribe and refuses a bounce and a complaint", async () => {
    const unsub = `${PREFIX}u@example.com`;
    const bounced = `${PREFIX}b@example.com`;
    const complained = `${PREFIX}c@example.com`;
    for (const email of [unsub, bounced, complained]) await makeContact(email);

    await suppress({ shopId, email: unsub, reason: "unsubscribed" });
    await suppress({ shopId, email: bounced, reason: "bounced" });
    await suppress({ shopId, email: complained, reason: "complained" });

    expect(await resubscribe(shopId, unsub)).toBe("lifted");
    expect(await resubscribe(shopId, bounced)).toBe("refused");
    expect(await resubscribe(shopId, complained)).toBe("refused");

    const left = await db
      .select({ email: emailSuppressions.email })
      .from(emailSuppressions)
      .where(eq(emailSuppressions.shopId, shopId));
    expect(left.map((r) => r.email).toSorted()).toEqual([bounced, complained].toSorted());
  });

  it("says nothing about an address it has never seen", async () => {
    expect(await resubscribe(shopId, `${PREFIX}never@example.com`)).toBe("absent");
  });
});

describe("the amendment — a contact with no address", () => {
  it("joins a list, which an address-keyed membership could not express", async () => {
    /*
     * The whole reason membership keys on `client_id`. A WhatsApp buyer has no
     * email, and the spec's `primary key (list_id, email)` has nowhere to put
     * them — they would be dropped from the seller's own customer list, which
     * is a bug in the CRM before it is anything to do with sending.
     */
    const clientId = await makePhoneContact("+15550001111");
    const listId = await makeList("Regulars");

    const joined = await joinList({ shopId, listId, clientId, source: "purchase" });
    expect(joined?.status).toBe("subscribed");

    const [row] = await db
      .select()
      .from(contactListMembers)
      .where(eq(contactListMembers.listId, listId));
    expect(row?.clientId).toBe(clientId);
    // Null rather than an invented placeholder: they have no address.
    expect(row?.email).toBeNull();

    // And they are not an email recipient, because there is nothing to send to.
    expect(await reach([listId])).toEqual([]);
  });
});

describe("ownership", () => {
  it("refuses to add a contact to another shop's list", async () => {
    const clientId = await makeContact(`${PREFIX}mine@example.com`);
    const theirShop = await makeShop();
    const [theirList] = await db
      .insert(contactLists)
      .values({ shopId: theirShop, name: "Theirs" })
      .returning({ id: contactLists.id });

    // The list lookup is the ownership check, and it is scoped in the same
    // statement rather than in a branch above it.
    expect(
      await joinList({ shopId, listId: theirList!.id, clientId, source: "manual" }),
    ).toBeNull();
  });
});
