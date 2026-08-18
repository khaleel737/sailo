import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  marketingOptOuts,
  newsletterDeliveries,
  newsletters,
  newsletterSubscribers,
  user,
} from "@sailo/db/schema";
import {
  confirmNewsletterSubscriber,
  createCampaign,
  deleteCampaign,
  listCampaigns,
  listNewsletterSubscribers,
  newsletterAudience,
  newsletterAudienceSize,
  newsletterGrowth,
  newsletterProgress,
  newsletterStats,
  newsletterToken,
  queueNewsletter,
  readNewsletterToken,
  runNewsletterQueue,
  topSubscriberSources,
} from "@sailo/marketing/newsletter/server";

/**
 * Sailo's own mailing list, against a real database.
 *
 * Everything here is a claim a unit test cannot make. Whether a second click
 * on a confirmation link writes a second row is a fact about a unique index;
 * whether the readers/sellers split actually finds the seller is a fact about
 * a folded-address subquery against a table this package does not own; whether
 * a queue drains once is a fact about `FOR UPDATE SKIP LOCKED`. None of those
 * can be answered from object literals.
 *
 * The rules being defended:
 *
 *  - nothing is written until the address is proven, and then exactly one row
 *    however many times the link is clicked;
 *  - how somebody joined is never rewritten by a later click — that column is
 *    the only answer to which writing actually works;
 *  - an opt-out outranks consent, a click can undo an unsubscribe, and no
 *    click can undo a spam complaint;
 *  - a campaign queues once, drains once, and cannot be edited or deleted
 *    after it starts.
 *
 * `setup.ts` deletes `RESEND_API_KEY`, so every send below is the transport
 * reporting "not configured" rather than an email leaving the building. That
 * is the point: this suite exercises the pipeline, and the provider call is a
 * seam with its own tests.
 */

const db = getDb();
const uid = () => crypto.randomUUID();

beforeAll(async () => {
  assertLocalDatabase();
  // These tables are shared with nothing else, so the suite owns them outright
  // — and starting from empty is what lets it assert on totals rather than on
  // deltas, which is the difference between a test that reads and one that
  // only ever confirms it went up.
  await db.delete(newsletterDeliveries);
  await db.delete(newsletters);
  await db.delete(newsletterSubscribers);
  await db.delete(marketingOptOuts);
});

const claimFor = (email: string, over: Partial<Parameters<typeof confirmNewsletterSubscriber>[0]> = {}) => ({
  email,
  name: "Ada",
  locale: "pt" as const,
  source: "article" as const,
  path: "/pt/blog/como-precificar",
  ...over,
});

describe("the confirmation token", () => {
  it("round-trips a claim it signed", () => {
    const claim = claimFor(`round-trip-${uid()}@example.com`);
    const token = newsletterToken(claim);
    expect(token).toBeTruthy();

    const read = readNewsletterToken(token!);
    expect(read?.email).toBe(claim.email);
    expect(read?.locale).toBe("pt");
    expect(read?.source).toBe("article");
    expect(read?.path).toBe(claim.path);
  });

  it("refuses a signature that is not ours", () => {
    const token = newsletterToken(claimFor("tamper@example.com"))!;
    const [payload] = token.split(".");
    expect(readNewsletterToken(`${payload}.notthesignature`)).toBeNull();
  });

  it("refuses a payload edited under a real signature", () => {
    /*
     * The attack the HMAC exists for: keep the signature, swap the address.
     * Without the check this would subscribe somebody who never asked.
     */
    const token = newsletterToken(claimFor("real@example.com"))!;
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ e: "victim@example.com", x: Math.floor(Date.now() / 1000) + 600 }),
      "utf8",
    ).toString("base64url");
    expect(readNewsletterToken(`${forged}.${signature}`)).toBeNull();
  });

  it("expires", () => {
    const token = newsletterToken(claimFor("expiring@example.com"))!;
    const eightDaysOn = new Date(Date.now() + 8 * 86_400_000);
    expect(readNewsletterToken(token, eightDaysOn)).toBeNull();
  });
});

describe("joining the list", () => {
  it("writes one row, and keeps how they joined", async () => {
    const email = `joiner-${uid()}@example.com`;
    const claim = claimFor(email);

    expect(await confirmNewsletterSubscriber(claim)).toBe("subscribed");

    const [row] = await db
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email));

    expect(row?.source).toBe("article");
    expect(row?.sourcePath).toBe("/pt/blog/como-precificar");
    expect(row?.locale).toBe("pt");
  });

  it("is idempotent, and never rewrites the attribution", async () => {
    const email = `twice-${uid()}@example.com`;
    await confirmNewsletterSubscriber(claimFor(email));

    const [first] = await db
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email));

    /*
     * The second click comes from a different page a fortnight later. It must
     * not move the row's story: "which page won this person" is the one
     * question the table exists to answer, and the answer is the first page.
     */
    await confirmNewsletterSubscriber(
      claimFor(email, { source: "footer", path: "/pricing", name: "Ada Lovelace" }),
    );

    const rows = await db
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe("article");
    expect(rows[0]?.sourcePath).toBe("/pt/blog/como-precificar");
    expect(rows[0]?.confirmedAt.getTime()).toBe(first!.confirmedAt.getTime());
  });

  it("folds the address, so two casings are one person", async () => {
    const local = `casing-${uid()}`;
    await confirmNewsletterSubscriber(claimFor(`${local}@example.com`));
    await confirmNewsletterSubscriber(claimFor(`${local.toUpperCase()}@EXAMPLE.COM`));

    const rows = await db
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, `${local}@example.com`));
    expect(rows).toHaveLength(1);
  });

  it("survives two clicks arriving at once", async () => {
    // Both halves of a double-tap, in flight together. The unique index is the
    // arbitration; without `onConflictDoUpdate` the loser throws in front of
    // somebody who has just done what we asked.
    const email = `race-${uid()}@example.com`;
    const results = await Promise.all([
      confirmNewsletterSubscriber(claimFor(email)),
      confirmNewsletterSubscriber(claimFor(email)),
    ]);

    expect(results).toEqual(["subscribed", "subscribed"]);
    const rows = await db
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email));
    expect(rows).toHaveLength(1);
  });
});

describe("leaving the list", () => {
  it("an opt-out outranks consent", async () => {
    const email = `leaver-${uid()}@example.com`;
    await confirmNewsletterSubscriber(claimFor(email));
    const before = await newsletterAudienceSize("all");

    await db.insert(marketingOptOuts).values({ email, reason: "unsubscribed" });
    expect(await newsletterAudienceSize("all")).toBe(before - 1);

    // Still on the list as a person — the gap between "joined" and "reach" is
    // the number a screen has to be able to show.
    const listed = await listNewsletterSubscribers({ q: email });
    expect(listed.rows[0]?.optedOutReason).toBe("unsubscribed");
  });

  it("a click brings back somebody who left by choice", async () => {
    const email = `returner-${uid()}@example.com`;
    await confirmNewsletterSubscriber(claimFor(email));
    await db.insert(marketingOptOuts).values({ email, reason: "unsubscribed" });

    expect(await confirmNewsletterSubscriber(claimFor(email))).toBe("subscribed");
    const gone = await db
      .select()
      .from(marketingOptOuts)
      .where(eq(marketingOptOuts.email, email));
    expect(gone).toHaveLength(0);
  });

  it("no click brings back a bounce or a complaint", async () => {
    for (const reason of ["bounced", "complained"] as const) {
      const email = `${reason}-${uid()}@example.com`;
      await confirmNewsletterSubscriber(claimFor(email));
      await db.delete(newsletterSubscribers).where(eq(newsletterSubscribers.email, email));
      await db.insert(marketingOptOuts).values({ email, reason });

      expect(await confirmNewsletterSubscriber(claimFor(email))).toBe("refused");
      const rows = await db
        .select()
        .from(newsletterSubscribers)
        .where(eq(newsletterSubscribers.email, email));
      expect(rows, reason).toHaveLength(0);
    }
  });
});

describe("who a campaign reaches", () => {
  it("splits readers from sellers on the address, folded", async () => {
    const readerEmail = `reader-${uid()}@example.com`;
    /*
     * Stored capitalised on the account and lower-cased on the list, which is
     * exactly how the two tables really diverge: `user.email` keeps what was
     * typed and this table folds. A raw comparison files this seller as a
     * reader and sends them the wrong campaign.
     */
    const sellerLocal = `Seller-${uid()}`;
    const sellerEmail = `${sellerLocal}@Example.com`;

    await db.insert(user).values({
      id: uid(),
      name: "Seller",
      email: sellerEmail,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await confirmNewsletterSubscriber(claimFor(readerEmail));
    await confirmNewsletterSubscriber(claimFor(sellerEmail.toLowerCase(), { source: "footer" }));

    const [all, readers, sellers] = await Promise.all([
      newsletterAudienceSize("all"),
      newsletterAudienceSize("readers"),
      newsletterAudienceSize("sellers"),
    ]);

    expect(readers + sellers).toBe(all);
    expect(sellers).toBeGreaterThanOrEqual(1);

    const cut = await newsletterAudience("sellers");
    expect(cut.recipients.map((r) => r.email)).toContain(sellerEmail.toLowerCase());
    expect(cut.recipients.map((r) => r.email)).not.toContain(readerEmail);
    expect(cut.clamped).toBe(false);
  });

  it("never returns an address that opted out", async () => {
    const email = `excluded-${uid()}@example.com`;
    await confirmNewsletterSubscriber(claimFor(email));
    await db.insert(marketingOptOuts).values({ email, reason: "unsubscribed" });

    const { recipients } = await newsletterAudience("all");
    expect(recipients.map((r) => r.email)).not.toContain(email);
  });
});

describe("the screens' queries", () => {
  it("reports numbers that add up", async () => {
    const stats = await newsletterStats();
    expect(stats.mailable + stats.unsubscribed + stats.refused).toBe(stats.confirmed);
    expect(stats.confirmed).toBeGreaterThan(0);
  });

  it("answers which page won them", async () => {
    const sources = await topSubscriberSources(20);
    const article = sources.find((s) => s.path === "/pt/blog/como-precificar");
    expect(article?.source).toBe("article");
    expect(article?.count).toBeGreaterThan(0);
  });

  it("says which subscribers went on to open an account", async () => {
    /*
     * The same select-list trap the campaign count fell into, on the other
     * screen: `hasAccount` and `shopHandle` are correlated subqueries in the
     * projection of `listNewsletterSubscribers`. That query joins, so drizzle
     * qualifies it — but the difference between "joins" and "does not" is not
     * something a reader of that file would think to check, and the failure is
     * silent in both directions: every subscriber a seller, or none.
     */
    const email = `converted-${uid()}@example.com`;
    await db.insert(user).values({
      id: uid(),
      name: "Converted",
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await confirmNewsletterSubscriber(claimFor(email));

    const readerEmail = `unconverted-${uid()}@example.com`;
    await confirmNewsletterSubscriber(claimFor(readerEmail));

    const converted = await listNewsletterSubscribers({ q: email });
    expect(converted.rows[0]?.hasAccount).toBe(true);

    const reader = await listNewsletterSubscribers({ q: readerEmail });
    expect(reader.rows[0]?.hasAccount).toBe(false);
    expect(reader.rows[0]?.shopHandle).toBeNull();
  });

  it("returns a day of growth per day that had any", async () => {
    const growth = await newsletterGrowth(30);
    expect(growth.length).toBeGreaterThanOrEqual(1);
    expect(growth.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))).toBe(true);
  });
});

describe("sending a campaign", () => {
  async function draft(over: Partial<Parameters<typeof createCampaign>[0]> = {}) {
    const id = await createCampaign(
      {
        subject: "A campaign",
        previewText: null,
        bodyMarkdown: "Hello **there**.",
        audience: "all",
        ctaLabel: null,
        ctaUrl: null,
        ...over,
      },
      "staff@sailo.store",
    );
    expect(id).toBeTruthy();
    return id!;
  }

  it("queues one delivery row per reachable address", async () => {
    const id = await draft();
    const reach = await newsletterAudienceSize("all");

    const result = await queueNewsletter({ newsletterId: id, from: "manual" });
    expect(result).toMatchObject({ ok: true, queued: reach, clamped: false });

    const progress = await newsletterProgress(id);
    expect(progress.total).toBe(reach);
    expect(progress.sent).toBe(0);
    expect(progress.queued).toBe(reach);
  });

  it("refuses a second Send, and writes nothing extra", async () => {
    const id = await draft();
    await queueNewsletter({ newsletterId: id, from: "manual" });
    const before = await newsletterProgress(id);

    const second = await queueNewsletter({ newsletterId: id, from: "manual" });
    expect(second.ok).toBe(false);
    expect((await newsletterProgress(id)).total).toBe(before.total);
  });

  it("cannot be deleted once it has started", async () => {
    const id = await draft();
    expect(await deleteCampaign(id)).toBe(true);

    const started = await draft();
    await queueNewsletter({ newsletterId: started, from: "manual" });
    expect(await deleteCampaign(started)).toBe(false);
  });

  it("finishes an empty audience rather than leaving it in flight", async () => {
    /*
     * A cut nobody matches. Left `queuing`, this would be retried on every
     * tick forever and the screen would show it as sending when nothing is.
     */
    await db.delete(newsletterSubscribers);
    const id = await draft();

    const result = await queueNewsletter({ newsletterId: id, from: "manual" });
    expect(result).toMatchObject({ ok: true, queued: 0 });

    const [row] = await db.select().from(newsletters).where(eq(newsletters.id, id));
    expect(row?.status).toBe("sent");
    expect(row?.recipientCount).toBe(0);
    expect(row?.sentAt).not.toBeNull();
  });

  it("drains a queue once, and marks the campaign sent", async () => {
    await db.delete(newsletterDeliveries);
    await db.delete(newsletters);
    await db.delete(newsletterSubscribers);
    await db.delete(marketingOptOuts);

    for (let i = 0; i < 3; i += 1) {
      await confirmNewsletterSubscriber(claimFor(`drain-${i}-${uid()}@example.com`));
    }

    const id = await draft();
    await queueNewsletter({ newsletterId: id, from: "manual" });

    /*
     * Two ticks racing, which is the shape a cron actually fails in: an
     * overlapping invocation, or a retry after a timeout. `FOR UPDATE SKIP
     * LOCKED` is what makes the pair claim three rows between them rather
     * than three each.
     */
    await Promise.all([runNewsletterQueue(), runNewsletterQueue()]);

    const progress = await newsletterProgress(id);
    expect(progress.total).toBe(3);
    expect(progress.queued).toBe(0);
    /*
     * `failed`, not `sent`: `setup.ts` removes `RESEND_API_KEY`, so the
     * transport reports "not configured" for every message. That is the
     * assertion worth making — each address was attempted exactly once and
     * the outcome was recorded against its own row.
     */
    expect(progress.sent + progress.failed).toBe(3);

    const [row] = await db.select().from(newsletters).where(eq(newsletters.id, id));
    expect(row?.status).toBe("sent");

    // And a third tick has nothing left to do.
    const after = await runNewsletterQueue();
    expect(after.sent).toBe(0);
    expect(after.failed).toBe(0);
  });

  it("counts what actually left, per campaign", async () => {
    /*
     * The regression this exists for.
     *
     * `listCampaigns` reported the delivered count with a correlated subquery
     * in the select list, and drizzle unqualifies the select list of a
     * single-table query — so `where deliveries.newsletter_id = newsletters.id`
     * rendered as `where "newsletter_id" = "id"`, both binding to the delivery
     * row. Valid SQL, no error, and zero for every campaign: the campaigns
     * screen showed "0 / 168" for a send that had fully delivered.
     *
     * Nothing about that is visible from a unit test or a type. It needs rows
     * in two tables and the query that joins them.
     */
    await db.delete(newsletterDeliveries);
    await db.delete(newsletters);
    await db.delete(newsletterSubscribers);

    for (let i = 0; i < 4; i += 1) {
      await confirmNewsletterSubscriber(claimFor(`counted-${i}-${uid()}@example.com`));
    }

    const sent = await draft({ subject: "Fully delivered" });
    await queueNewsletter({ newsletterId: sent, from: "manual" });
    // Stand in for a provider that accepted all four.
    await db
      .update(newsletterDeliveries)
      .set({ status: "sent", sentAt: new Date(), providerId: "resend_test" })
      .where(eq(newsletterDeliveries.newsletterId, sent));

    const untouched = await draft({ subject: "Never sent" });

    const listed = await listCampaigns(1);
    const delivered = listed.rows.find((r) => r.id === sent);
    const nothing = listed.rows.find((r) => r.id === untouched);

    expect(delivered?.delivered).toBe(4);
    // A draft with no deliveries must still appear — a `LEFT` join, not inner.
    expect(nothing).toBeDefined();
    expect(nothing?.delivered).toBe(0);
    // One row per campaign, not one per delivery.
    expect(listed.rows.filter((r) => r.id === sent)).toHaveLength(1);
  });

  it("mails one address once, even when two people share it", async () => {
    await db.delete(newsletterDeliveries);
    await db.delete(newsletters);
    await db.delete(newsletterSubscribers);

    const shared = `shared-${uid()}@example.com`;
    await confirmNewsletterSubscriber(claimFor(shared));

    const id = await draft();
    await queueNewsletter({ newsletterId: id, from: "manual" });

    const [row] = await db
      .select({ n: sql<string>`count(*)` })
      .from(newsletterDeliveries)
      .where(eq(newsletterDeliveries.newsletterId, id));
    expect(Number(row?.n)).toBe(1);
  });
});
