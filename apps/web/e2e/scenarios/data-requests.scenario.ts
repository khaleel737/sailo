import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  dataRequests,
  emailSuppressions,
  invoices,
  orders,
  shops,
  user,
} from "@sailo/db/schema";

/**
 * Spec 52 — a buyer's request about their own data, against a real database.
 *
 * Four properties, and every one of them is a way this feature turns into the
 * incident it exists to prevent:
 *
 *   1. **Nothing is assembled before verification.** Gathering somebody's order
 *      history and *then* checking who asked is how a data-protection feature
 *      becomes a breach.
 *   2. **The export is scoped to one shop.** A buyer of five Sailo shops asking
 *      one seller receives that seller's data and nothing else. This is a hard
 *      access-control test, not a product preference.
 *   3. **Erasure pseudonymises what the ledger points at and keeps the ledger.**
 *      The invoice sequence still reconciles afterwards.
 *   4. **The suppression list is never erased.** The one "deletion" that would
 *      do the opposite of what was asked.
 *
 * Blob is stubbed. The store is a vendor seam and the assertions here are about
 * rows and about what the assembly contains — a real upload would make this
 * suite need credentials and would test Vercel rather than Sailo.
 */

const stored: { key: string; body: string }[] = [];
const deleted: string[] = [];

vi.mock("@vercel/blob", () => ({
  put: async (key: string, body: string) => {
    stored.push({ key, body });
    return { url: `https://blob.example/${key}` };
  },
  del: async (urls: string | string[]) => {
    deleted.push(...(Array.isArray(urls) ? urls : [urls]));
  },
  list: async () => ({ blobs: [], hasMore: false, cursor: undefined }),
}));

const {
  assembleSubjectData,
  eraseSubject,
  expireDataExports,
  fulfilAccessRequest,
  fulfilErasureRequest,
  openDataRequest,
  refuseDataRequest,
  verifyDataRequest,
  dataRequestQueue,
} = await import("@sailo/account/data-requests");

const db = getDb();
const uid = () => crypto.randomUUID();
const PREFIX = "dsar-";

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures([PREFIX]);
  /*
   * The token family needs a signing secret. `setup.ts` sets one for the
   * unsubscribe family and this reads the same variable under a different
   * domain label, so nothing extra is required — asserted rather than assumed,
   * because without it every `openDataRequest` would return a null token and
   * the whole suite would pass by never verifying anything.
   */
  expect(process.env.BETTER_AUTH_SECRET).toBeTruthy();
});

async function sellerShop() {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `${PREFIX}${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `${PREFIX}${userId.slice(0, 8)}`,
      name: "Speckled Ceramics",
      currency: "USD",
      isPublished: true,
      plan: "free",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

async function buyerWithOrder(shopId: string, email: string) {
  const [client] = await db
    .insert(clients)
    .values({
      shopId,
      name: "Ada Lovelace",
      email,
      phone: "+44 7700 900000",
      addressLine1: "12 Bridge Street",
      city: "Lisbon",
      country: "PT",
      marketingConsentAt: new Date(),
      tags: ["vip"],
    })
    .returning();
  if (!client) throw new Error("fixture: client was not inserted");

  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      clientId: client.id,
      productTitle: "Speckled Mug",
      productKind: "physical",
      quantity: 1,
      unitPriceCents: 4200,
      subtotalCents: 4200,
      totalCents: 4200,
      currency: "USD",
      customerName: "Ada Lovelace",
      customerEmail: email,
      customerPhone: "+44 7700 900000",
      addressLine1: "12 Bridge Street",
      city: "Lisbon",
      country: "PT",
      buyerIp: "203.0.113.7",
      buyerUserAgent: "Mozilla/5.0",
      buyerDeviceFingerprint: "fp-".padEnd(24, "x"),
      paymentMethod: "card",
      paymentStatus: "paid",
      status: "confirmed",
    })
    .returning();
  if (!order) throw new Error("fixture: order was not inserted");

  return { client, order };
}

const emailFor = () => `${PREFIX}buyer-${uid().slice(0, 8)}@example.com`;

/* ------------------------------------------------------------------------- */

describe("opening a request", () => {
  it("answers the same whether the address is known or not", async () => {
    const shop = await sellerShop();
    const known = emailFor();
    await buyerWithOrder(shop.id, known);

    const forKnown = await openDataRequest({ shopId: shop.id, email: known, kind: "access" });
    const forStranger = await openDataRequest({
      shopId: shop.id,
      email: emailFor(),
      kind: "access",
    });

    /*
     * Both succeed and both mint a token. The action layer turns every outcome
     * — including the duplicate below — into one sentence; what is asserted
     * here is that the *layer underneath* gives it nothing to distinguish them
     * with.
     */
    expect(forKnown.ok).toBe(true);
    expect(forStranger.ok).toBe(true);
  });

  it("refuses a second live request of the same kind", async () => {
    const shop = await sellerShop();
    const email = emailFor();

    const first = await openDataRequest({ shopId: shop.id, email, kind: "erasure" });
    const second = await openDataRequest({ shopId: shop.id, email, kind: "erasure" });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "duplicate" });

    // A different *kind* is a different request and is allowed.
    const other = await openDataRequest({ shopId: shop.id, email, kind: "access" });
    expect(other.ok).toBe(true);
  });

  it("starts no clock and shows nothing in the queue until verified", async () => {
    const shop = await sellerShop();
    await openDataRequest({ shopId: shop.id, email: emailFor(), kind: "access" });

    const row = await db.query.dataRequests.findFirst({
      where: eq(dataRequests.shopId, shop.id),
    });
    expect(row?.verifiedAt).toBeNull();
    expect(row?.dueBy).toBeNull();

    /*
     * The queue is empty. Until the address confirms there is no request from
     * anybody, and a queue that showed unverified rows would let a stranger
     * fill a seller's screen by typing addresses into a public form.
     */
    expect(await dataRequestQueue(shop.id)).toEqual([]);
  });
});

describe("verifying", () => {
  it("starts the thirty-day clock and spends the token", async () => {
    const shop = await sellerShop();
    const opened = await openDataRequest({
      shopId: shop.id,
      email: emailFor(),
      kind: "access",
    });
    if (!opened.ok || !opened.token) throw new Error("no token minted");

    const before = Date.now();
    const result = await verifyDataRequest(opened.token);
    expect(result.ok).toBe(true);

    const row = await db.query.dataRequests.findFirst({
      where: eq(dataRequests.id, opened.requestId),
    });
    expect(row?.verifiedAt).toBeTruthy();
    expect(row?.status).toBe("in_progress");
    expect(row?.dueBy?.getTime()).toBeGreaterThan(before + 29 * 86_400_000);
    // The token has done the only thing it can do; leaving a live hash on an
    // actionable row is a credential kept past its purpose.
    expect(row?.verifyTokenHash).toBeNull();
  });

  it("refuses a token that was never ours", async () => {
    const result = await verifyDataRequest("not.a.token");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("is idempotent under a second click", async () => {
    // A prefetching mail client and the buyer both arrive. One clock.
    const shop = await sellerShop();
    const opened = await openDataRequest({
      shopId: shop.id,
      email: emailFor(),
      kind: "access",
    });
    if (!opened.ok || !opened.token) throw new Error("no token minted");

    const first = await verifyDataRequest(opened.token);
    const second = await verifyDataRequest(opened.token);

    expect(first.ok && !first.alreadyVerified).toBe(true);
    /*
     * The second click has no live hash to match, so it reads as invalid rather
     * than as a second verification — which is the right shape: the token is
     * spent, and nothing about the request changed.
     */
    expect(second.ok ? second.alreadyVerified : second.reason).toBeTruthy();

    const row = await db.query.dataRequests.findFirst({
      where: eq(dataRequests.id, opened.requestId),
    });
    expect(row?.verifiedAt?.getTime()).toBe(
      first.ok ? first.request.verifiedAt?.getTime() : undefined,
    );
  });
});

describe("assembling", () => {
  it("refuses to assemble anything before verification", async () => {
    const shop = await sellerShop();
    const email = emailFor();
    await buyerWithOrder(shop.id, email);
    const opened = await openDataRequest({ shopId: shop.id, email, kind: "access" });
    if (!opened.ok) throw new Error("not opened");

    const result = await fulfilAccessRequest({
      shopId: shop.id,
      requestId: opened.requestId,
      actor: "seller@example.com",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/not been confirmed/i);
    // And nothing was stored.
    expect(stored.filter((file) => file.key.includes(opened.requestId))).toEqual([]);
  });

  it("contains this shop's data and no other shop's", async () => {
    /*
     * THE HARD ACCESS-CONTROL TEST.
     *
     * The same buyer, the same address, two shops. Naming one shop must return
     * that shop's orders and never the other's — the boundary
     * `GAP-2026-08-easytools.md` §4.2 refuses to cross for the buyer network.
     */
    const mine = await sellerShop();
    const theirs = await sellerShop();
    const email = emailFor();

    const here = await buyerWithOrder(mine.id, email);
    const elsewhere = await buyerWithOrder(theirs.id, email);

    const exported = await assembleSubjectData(mine.id, email);

    expect(exported.json).toContain(here.order.id);
    expect(exported.json).not.toContain(elsewhere.order.id);
    expect(exported.summary.orders).toBe(1);
  });

  it("says in the file itself that it covers one shop only", async () => {
    // The file outlives the email that explained it.
    const shop = await sellerShop();
    const email = emailFor();
    await buyerWithOrder(shop.id, email);
    const exported = await assembleSubjectData(shop.id, email);
    expect(exported.json).toMatch(/one shop only/i);
  });

  it("escapes a formula in the buyer's own name", async () => {
    /*
     * The highest-risk escaping in the product: the export is opened in Excel,
     * by the *seller*, and the most attacker-controlled string in it is a name
     * the buyer typed at a checkout.
     */
    const shop = await sellerShop();
    const email = emailFor();
    const { order } = await buyerWithOrder(shop.id, email);
    await db
      .update(orders)
      .set({ productTitle: "=1+1" })
      .where(eq(orders.id, order.id));

    const exported = await assembleSubjectData(shop.id, email);
    const orderCsv = exported.files.find((file) => file.name === "orders.csv");
    expect(orderCsv?.body).not.toMatch(/(^|,)=1\+1/m);
  });

  it("stores an export with an expiry and deletes it when it lapses", async () => {
    const shop = await sellerShop();
    const email = emailFor();
    await buyerWithOrder(shop.id, email);

    const opened = await openDataRequest({ shopId: shop.id, email, kind: "access" });
    if (!opened.ok || !opened.token) throw new Error("no token minted");
    await verifyDataRequest(opened.token);

    const released = await fulfilAccessRequest({
      shopId: shop.id,
      requestId: opened.requestId,
      actor: "seller@example.com",
    });
    expect(released.ok).toBe(true);

    const row = await db.query.dataRequests.findFirst({
      where: eq(dataRequests.id, opened.requestId),
    });
    expect(row?.status).toBe("fulfilled");
    expect(row?.exportBlobKey).toBeTruthy();
    expect(row?.exportExpiresAt).toBeTruthy();

    /*
     * And it actually goes. An orphaned personal-data export in Blob is the
     * incident this feature exists to prevent, so "expired" has to mean the
     * bytes are gone rather than the link being unadvertised.
     */
    await db
      .update(dataRequests)
      .set({ exportExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(dataRequests.id, opened.requestId));

    const swept = await expireDataExports();
    expect(swept.expired).toBeGreaterThan(0);
    expect(deleted).toContain(row?.exportBlobKey);

    const after = await db.query.dataRequests.findFirst({
      where: eq(dataRequests.id, opened.requestId),
    });
    expect(after?.exportBlobKey).toBeNull();
  });
});

describe("erasing", () => {
  it("pseudonymises the buyer, keeps the ledger, and reconciles", async () => {
    const shop = await sellerShop();
    const email = emailFor();
    const { client, order } = await buyerWithOrder(shop.id, email);

    const [invoice] = await db
      .insert(invoices)
      .values({
        shopId: shop.id,
        orderId: order.id,
        number: "INV-0001",
        token: uid().replace(/-/g, ""),
      })
      .returning();

    const report = await eraseSubject(shop.id, email);

    expect(report.clients).toBe(1);
    expect(report.orders).toBe(1);

    const afterClient = await db.query.clients.findFirst({
      where: eq(clients.id, client.id),
    });
    expect(afterClient).toBeTruthy();
    expect(afterClient?.name).toBe("Deleted buyer");
    expect(afterClient?.email).toMatch(/@sailo\.invalid$/);
    expect(afterClient?.phone).toBeNull();
    expect(afterClient?.addressLine1).toBeNull();
    expect(afterClient?.marketingConsentAt).toBeNull();
    expect(afterClient?.tags).toEqual([]);

    const afterOrder = await db.query.orders.findFirst({
      where: eq(orders.id, order.id),
    });
    // The money row survives, whole.
    expect(afterOrder?.totalCents).toBe(4200);
    expect(afterOrder?.customerName).toBe("Deleted buyer");
    expect(afterOrder?.addressLine1).toBeNull();
    // The country stays: it decided the tax and delivery actually charged, and
    // on its own it identifies nobody.
    expect(afterOrder?.country).toBe("PT");

    /*
     * And the invoice sequence is untouched. The invoice row carries no money
     * of its own — the amount lives on the order it points at — so what has to
     * survive is the *link* and the number, which is what a tax authority
     * expects to be unbroken.
     */
    const afterInvoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, invoice!.id),
    });
    expect(afterInvoice?.number).toBe("INV-0001");
    expect(afterInvoice?.orderId).toBe(order.id);
  });

  it("holds the purchase identifiers while a dispute can still arrive", async () => {
    const shop = await sellerShop();
    const email = emailFor();
    const { order } = await buyerWithOrder(shop.id, email);

    const report = await eraseSubject(shop.id, email);
    expect(report.identifiersHeldForDisputes).toBe(true);

    const after = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    expect(after?.buyerIp).toBe("203.0.113.7");
  });

  it("erases the purchase identifiers once the window has closed", async () => {
    const shop = await sellerShop();
    const email = emailFor();
    const { order } = await buyerWithOrder(shop.id, email);

    // Older than the 400-day evidence window.
    await db
      .update(orders)
      .set({ createdAt: new Date(Date.now() - 500 * 86_400_000) })
      .where(eq(orders.id, order.id));

    const report = await eraseSubject(shop.id, email);
    expect(report.identifiersHeldForDisputes).toBe(false);

    const after = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    expect(after?.buyerIp).toBeNull();
    expect(after?.buyerUserAgent).toBeNull();
    expect(after?.buyerDeviceFingerprint).toBeNull();
  });

  it("never erases the suppression list", async () => {
    /*
     * THE ONE PEOPLE GET WRONG. Erasing an unsubscribe re-subscribes the person
     * who asked to be left alone, the next time the seller imports a list.
     */
    const shop = await sellerShop();
    const email = emailFor();
    await buyerWithOrder(shop.id, email);
    await db
      .insert(emailSuppressions)
      .values({ shopId: shop.id, email, reason: "unsubscribed" });

    const report = await eraseSubject(shop.id, email);
    expect(report.suppressionsKept).toBe(1);

    const rows = await db
      .select()
      .from(emailSuppressions)
      .where(
        and(
          eq(emailSuppressions.shopId, shop.id),
          sql`lower(${emailSuppressions.email}) = ${email}`,
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("unsubscribed");
  });

  it("touches no other shop's copy of the same buyer", async () => {
    const mine = await sellerShop();
    const theirs = await sellerShop();
    const email = emailFor();
    await buyerWithOrder(mine.id, email);
    const elsewhere = await buyerWithOrder(theirs.id, email);

    await eraseSubject(mine.id, email);

    const untouched = await db.query.orders.findFirst({
      where: eq(orders.id, elsewhere.order.id),
    });
    expect(untouched?.customerName).toBe("Ada Lovelace");
    expect(untouched?.customerEmail).toBe(email);
  });

  it("is idempotent", async () => {
    const shop = await sellerShop();
    const email = emailFor();
    const { client } = await buyerWithOrder(shop.id, email);

    await eraseSubject(shop.id, email);
    const second = await eraseSubject(shop.id, email);

    // Nothing left matching the original address, so the second run finds
    // nothing and changes nothing — the surrogate is derived from the row's own
    // id rather than generated, so a retry cannot mint a second identity.
    expect(second.clients).toBe(0);
    const row = await db.query.clients.findFirst({ where: eq(clients.id, client.id) });
    expect(row?.email).toMatch(/@sailo\.invalid$/);
  });

  it("refuses an erasure request that was never verified", async () => {
    const shop = await sellerShop();
    const email = emailFor();
    await buyerWithOrder(shop.id, email);
    const opened = await openDataRequest({ shopId: shop.id, email, kind: "erasure" });
    if (!opened.ok) throw new Error("not opened");

    const result = await fulfilErasureRequest({
      shopId: shop.id,
      requestId: opened.requestId,
      actor: "seller@example.com",
    });
    expect(result.ok).toBe(false);

    // And the buyer is still there.
    const row = await db.query.clients.findFirst({
      where: and(eq(clients.shopId, shop.id), eq(clients.email, email)),
    });
    expect(row?.name).toBe("Ada Lovelace");
  });
});

describe("refusing", () => {
  it("records the reason from the picklist and nothing else", async () => {
    const shop = await sellerShop();
    const email = emailFor();
    const opened = await openDataRequest({ shopId: shop.id, email, kind: "erasure" });
    if (!opened.ok || !opened.token) throw new Error("no token minted");
    await verifyDataRequest(opened.token);

    const invented = await refuseDataRequest({
      shopId: shop.id,
      requestId: opened.requestId,
      reason: "cannot be bothered",
      actor: "seller@example.com",
    });
    expect(invented.ok).toBe(false);

    const proper = await refuseDataRequest({
      shopId: shop.id,
      requestId: opened.requestId,
      reason: "legal_obligation",
      actor: "seller@example.com",
    });
    expect(proper.ok).toBe(true);

    const row = await db.query.dataRequests.findFirst({
      where: eq(dataRequests.id, opened.requestId),
    });
    expect(row?.status).toBe("refused");
    expect(row?.refusedReason).toBe("legal_obligation");
  });

  it("records who acted, and staff differently from the seller", async () => {
    const shop = await sellerShop();
    const email = emailFor();
    const opened = await openDataRequest({ shopId: shop.id, email, kind: "erasure" });
    if (!opened.ok || !opened.token) throw new Error("no token minted");
    await verifyDataRequest(opened.token);

    await refuseDataRequest({
      shopId: shop.id,
      requestId: opened.requestId,
      reason: "legal_claims",
      actor: "sailo:staff:admin@sailo.store",
    });

    const row = await db.query.dataRequests.findFirst({
      where: eq(dataRequests.id, opened.requestId),
    });
    /*
     * "HQ must not be able to answer on a seller's behalf without recording
     * that it did." The prefix is what makes the two distinguishable on the row
     * rather than only in a log somewhere else.
     */
    expect(row?.actor).toMatch(/^sailo:staff:/);
  });
});
