import { describe, expect, it, vi } from "vitest";
import type * as sessionModule from "@/lib/session";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  creatorReferrals,
  partners,
  referralEarnings,
  shops,
  user,
} from "@sailo/db/schema";
import {
  attributeReferral,
  getPartnerSummary,
  recordReferralEarning,
  reverseReferralEarning,
} from "@/lib/partners/store";
import { applyToProgram, approvePartner } from "@/lib/partners/applications";
import { getProgramSettings } from "@/lib/partners/settings";
import { markPaidManually } from "@/lib/hq/partners";
import { assertLocalDatabase } from "./local-only";

/**
 * The partner ledger, against a real database.
 *
 * Unit tests pin the arithmetic; this pins the constraints — and the
 * constraints are where this feature actually lives. Every rule that stops the
 * programme paying out money it shouldn't is a unique index or a check in
 * `drizzle/0013_partner_program.sql`, and none of them can be exercised
 * without Postgres enforcing them:
 *
 *   - a second link never overwrites the first partner
 *   - a replayed `invoice.paid` never earns twice
 *   - a refund appends rather than rewrites
 *   - a suspended partner stops earning on creators they already brought
 *   - the hold period actually withholds
 *   - a double-clicked settle stamps once
 *
 * Run with:
 *   ./e2e/scenarios/up.sh
 *   npx vitest run --config vitest.scenarios.mts \
 *     e2e/scenarios/partner-program.scenario.ts
 */

/*
 * `markPaidManually` guards itself with `requireStaff()` — deliberately, and
 * that guard is not what this file is testing. With no request there is no
 * session, so it would redirect to /hq/login before touching a row. Only the
 * two session reads are replaced; everything else in the module stays real, so
 * a future read that starts using it is not silently unguarded here.
 */
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof sessionModule>()),
  requireStaff: async () => ({
    id: "scenario-staff",
    email: "staff@sailo.store",
    emailVerified: true,
  }),
}));

let seq = 0;

/** A seller with a shop, who may or may not also be a partner. */
async function makeSeller(label: string) {
  assertLocalDatabase();
  const db = getDb();
  const userId = crypto.randomUUID();
  const email = `ref-${label}-${userId}@example.com`;

  await db.insert(user).values({
    id: userId,
    name: `Seller ${label}`,
    email,
    emailVerified: true,
  });

  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `ref-${label}-${userId.slice(0, 8)}`,
      name: `Shop ${label}`,
      currency: "USD",
      isPublished: true,
      /*
       * On a paid plan with Stripe connected, because that is what the
       * programme now requires of a partner. A free-plan fixture would make
       * every earning test fail for the right reason and the wrong one — the
       * subscription gate is exercised deliberately in its own block below.
       */
      plan: "pro",
      subscriptionStatus: "active",
      stripeAccountId: `acct_${userId.slice(0, 16)}`,
      stripeChargesEnabled: true,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  return { shop, userId, email };
}

/** An approved partner with a live code, plus the shop they happen to own. */
async function makePartner(label: string) {
  const seller = await makeSeller(label);

  const applied = await applyToProgram({
    userId: seller.userId,
    name: `Partner ${label}`,
  });
  if (!applied.ok) throw new Error(`fixture: application refused — ${applied.error}`);

  const code = await approvePartner(applied.partnerId, "scenario@sailo.store");
  return { ...seller, partnerId: applied.partnerId, code };
}

/**
 * A partner with no shop — now an ineligible one.
 *
 * The programme requires an active Sailo subscription, so somebody with no
 * shop has nothing to subscribe with and no account to be paid into. Kept as a
 * fixture precisely so the tests below can prove they cannot earn, rather than
 * proving it by never constructing one.
 */
async function makeShoplessPartner(label: string) {
  assertLocalDatabase();
  const db = getDb();
  const userId = crypto.randomUUID();
  const email = `aud-${label}-${userId}@example.com`;

  await db.insert(user).values({
    id: userId,
    name: `Writer ${label}`,
    email,
    emailVerified: true,
  });

  const applied = await applyToProgram({ userId, name: `Writer ${label}` });
  if (!applied.ok) throw new Error(`fixture: application refused — ${applied.error}`);

  const code = await approvePartner(applied.partnerId, "scenario@sailo.store");
  return { userId, email, partnerId: applied.partnerId, code };
}

/** A Stripe invoice id that is unique per call, like a real one. */
const invoiceId = () => `in_scenario_${(seq += 1)}_${crypto.randomUUID().slice(0, 8)}`;

/**
 * Ages a partner's ledger past the hold period.
 *
 * The hold is a real setting with a real default, so nothing is payable the
 * day it is earned. Rather than turning the hold off globally — which would
 * mean these tests stopped covering it — payout tests age their own rows and
 * one test below asserts the hold works by *not* doing this.
 */
async function matureEverything(partnerId: string) {
  await getDb()
    .update(referralEarnings)
    .set({ matureAt: new Date(Date.now() - 1000) })
    .where(
      sql`${referralEarnings.referralId} in (
        select ${creatorReferrals.id} from ${creatorReferrals}
        where ${creatorReferrals.partnerId} = ${partnerId}
      )`,
    );
}

/** The rate the programme is actually configured at, so sums aren't hardcoded. */
async function share(invoiceCents: number) {
  const { commissionBp } = await getProgramSettings();
  return Math.floor((invoiceCents * commissionBp) / 10_000);
}

const summaryFor = async (partnerId: string) => {
  const { payoutMinimumCents } = await getProgramSettings();
  return getPartnerSummary(partnerId, payoutMinimumCents);
};

describe("applying", () => {
  it("links an approved partner to the shop they subscribe with", async () => {
    const seller = await makePartner("linked");

    const row = await getDb().query.partners.findFirst({
      where: eq(partners.id, seller.partnerId),
    });

    // The shop is the whole identity now: it carries the subscription that
    // lets them earn and the Stripe account the commission is paid into.
    expect(row?.shopId).toBe(seller.shop.id);
    expect(row?.status).toBe("approved");
    expect(row?.code).toBe(seller.code);
  });

  it("files one application per person however many times they submit", async () => {
    const seller = await makeSeller("dupe");

    const first = await applyToProgram({ userId: seller.userId, name: "Dupe" });
    const second = await applyToProgram({ userId: seller.userId, name: "Dupe again" });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    // The unique index is the guard — the second submit finds the first row.
    expect(second.partnerId).toBe(first.partnerId);
  });

  it("refuses to approve without minting a code", async () => {
    // `partners_approved_has_code` is the floor under `approvePartner`: an
    // approved partner with nothing to share is a dead end they could only
    // discover by asking us.
    const writer = await makeShoplessPartner("coded");
    const row = await getDb().query.partners.findFirst({
      where: eq(partners.id, writer.partnerId),
    });
    expect(row?.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);

    await expect(
      getDb()
        .update(partners)
        .set({ code: null })
        .where(eq(partners.id, writer.partnerId)),
    ).rejects.toThrow();
  });

  it("keeps one code however many times approval is re-run", async () => {
    const writer = await makeShoplessPartner("stable");
    // Re-approving a reinstated partner must not rotate a code that is already
    // printed in somebody's newsletter.
    expect(await approvePartner(writer.partnerId, "scenario@sailo.store")).toBe(
      writer.code,
    );
  });
});

describe("attribution", () => {
  it("records the partner, once, and refuses a second link", async () => {
    const first = await makePartner("first");
    const second = await makePartner("second");
    const joiner = await makeSeller("joiner");

    expect(
      await attributeReferral({
        referredShopId: joiner.shop.id,
        referredUserId: joiner.userId,
        referredEmail: joiner.email,
        rawCode: first.code,
      }),
    ).toBe("attributed");

    /*
     * First touch wins. This is the unique index doing the work, not a read
     * before the write — which matters because two links can arrive at the
     * same signup at the same time.
     */
    expect(
      await attributeReferral({
        referredShopId: joiner.shop.id,
        referredUserId: joiner.userId,
        referredEmail: joiner.email,
        rawCode: second.code,
      }),
    ).toBe("already_referred");

    const rows = await getDb()
      .select()
      .from(creatorReferrals)
      .where(eq(creatorReferrals.referredShopId, joiner.shop.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.partnerId).toBe(first.partnerId);
    expect(rows[0]?.code).toBe(first.code);
  });

  it("refuses a partner using their own address, and stores nothing", async () => {
    const self = await makePartner("self");
    const other = await makeSeller("selfother");

    expect(
      await attributeReferral({
        // A different account, but the same person's email — the trivial
        // self-referral, and the one worth closing.
        referredShopId: other.shop.id,
        referredUserId: other.userId,
        referredEmail: self.email.toUpperCase(),
        rawCode: self.code,
      }),
    ).toBe("self");

    expect(
      await getDb()
        .select()
        .from(creatorReferrals)
        .where(eq(creatorReferrals.referredShopId, other.shop.id)),
    ).toHaveLength(0);
  });

  it("refuses a partner referring their own shop", async () => {
    const partner = await makePartner("ownshop");
    expect(
      await attributeReferral({
        referredShopId: partner.shop.id,
        referredUserId: partner.userId,
        referredEmail: "someone-else@example.com",
        rawCode: partner.code,
      }),
    ).toBe("self");
  });

  it("treats an unknown or malformed code as no referral at all", async () => {
    const joiner = await makeSeller("unknown");

    for (const rawCode of ["ZZZZZZZZ", "nope", "' OR 1=1", "", null]) {
      expect(
        await attributeReferral({
          referredShopId: joiner.shop.id,
          referredUserId: joiner.userId,
          referredEmail: joiner.email,
          rawCode,
        }),
      ).toMatch(/^(unknown_code|no_code)$/);
    }
  });

  /*
   * A partner we stopped must stop bringing people in. Their links are already
   * posted and will keep being clicked forever — the status is the only thing
   * standing between a suspended partner and a growing ledger.
   */
  it("refuses a suspended partner's code without saying why", async () => {
    const partner = await makePartner("suspended");
    const joiner = await makeSeller("suspjoiner");

    await getDb()
      .update(partners)
      .set({ status: "suspended" })
      .where(eq(partners.id, partner.partnerId));

    expect(
      await attributeReferral({
        referredShopId: joiner.shop.id,
        referredUserId: joiner.userId,
        referredEmail: joiner.email,
        rawCode: partner.code,
      }),
    ).toBe("unknown_code");
  });
});

describe("the ledger", () => {
  it("earns the programme rate once, however many times Stripe delivers", async () => {
    const partner = await makePartner("earner");
    const referred = await makeSeller("payer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    const invoice = invoiceId();
    const earn = () =>
      recordReferralEarning({
        referredShopId: referred.shop.id,
        stripeInvoiceId: invoice,
        invoiceAmountCents: 1999,
        currency: "usd",
      });

    expect(await earn()).toBe(true);
    // The replay. The unique index is the guard, so this adds nothing.
    expect(await earn()).toBe(false);

    const expected = await share(1999);
    const summary = await summaryFor(partner.partnerId);
    expect(summary.lifetimeCents).toBe(expected);
    expect(summary.unpaidCents).toBe(expected);
    expect(summary.referredCount).toBe(1);
    expect(summary.convertedCount).toBe(1);
    expect(summary.currency).toBe("USD");
  });

  /*
   * The rate is copied onto the row, not referenced. Changing the programme's
   * rate must never restate what we owed for an invoice paid last quarter.
   */
  it("records the rate it was computed at, so history can't be restated", async () => {
    const partner = await makePartner("rated");
    const referred = await makeSeller("ratedpayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    const invoice = invoiceId();
    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoice,
      invoiceAmountCents: 1999,
      currency: "usd",
    });

    const { commissionBp } = await getProgramSettings();
    const [row] = await getDb()
      .select()
      .from(referralEarnings)
      .where(eq(referralEarnings.stripeInvoiceId, invoice));

    expect(row?.commissionBp).toBe(commissionBp);
    // amount ÷ rate reproduces the invoice, which is what makes it auditable.
    expect(row?.amountCents).toBe(Math.floor((1999 * commissionBp) / 10_000));
  });

  it("pays a negotiated rate to the partner who negotiated it", async () => {
    const partner = await makePartner("vip");
    const referred = await makeSeller("vippayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    await getDb()
      .update(partners)
      .set({ commissionBp: 5000 })
      .where(eq(partners.id, partner.partnerId));

    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoiceId(),
      invoiceAmountCents: 1999,
      currency: "usd",
    });

    expect((await summaryFor(partner.partnerId)).lifetimeCents).toBe(999);
  });

  /*
   * Suspension has to reach the creators the partner already brought. Those
   * shops keep paying us every month, and if their invoices keep earning
   * commission then suspending somebody means nothing.
   */
  it("stops a suspended partner earning on creators they already brought", async () => {
    const partner = await makePartner("stopped");
    const referred = await makeSeller("stoppedpayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoiceId(),
      invoiceAmountCents: 1999,
      currency: "usd",
    });
    const earned = (await summaryFor(partner.partnerId)).lifetimeCents;
    expect(earned).toBeGreaterThan(0);

    await getDb()
      .update(partners)
      .set({ status: "suspended" })
      .where(eq(partners.id, partner.partnerId));

    // Next month's invoice for the same creator earns nothing.
    expect(
      await recordReferralEarning({
        referredShopId: referred.shop.id,
        stripeInvoiceId: invoiceId(),
        invoiceAmountCents: 1999,
        currency: "usd",
      }),
    ).toBe(false);

    expect((await summaryFor(partner.partnerId)).lifetimeCents).toBe(earned);
  });

  it("stamps the conversion date once and never moves it", async () => {
    const partner = await makePartner("conv");
    const referred = await makeSeller("convpayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoiceId(),
      invoiceAmountCents: 999,
      currency: "usd",
    });
    const [after1] = await getDb()
      .select()
      .from(creatorReferrals)
      .where(eq(creatorReferrals.referredShopId, referred.shop.id));

    // A second month must not restamp "converted on…" to today.
    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoiceId(),
      invoiceAmountCents: 999,
      currency: "usd",
    });
    const [after2] = await getDb()
      .select()
      .from(creatorReferrals)
      .where(eq(creatorReferrals.referredShopId, referred.shop.id));

    expect(after1?.convertedAt).toBeTruthy();
    expect(after2?.convertedAt?.getTime()).toBe(after1?.convertedAt?.getTime());
  });

  it("earns nothing from a trial or a fully discounted invoice", async () => {
    const partner = await makePartner("trialref");
    const referred = await makeSeller("trialpayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    expect(
      await recordReferralEarning({
        referredShopId: referred.shop.id,
        stripeInvoiceId: invoiceId(),
        invoiceAmountCents: 0,
        currency: "usd",
      }),
    ).toBe(false);

    const summary = await summaryFor(partner.partnerId);
    expect(summary.lifetimeCents).toBe(0);
    expect(summary.convertedCount).toBe(0);
  });

  it("earns nothing for a signup nobody referred", async () => {
    const stranger = await makeSeller("stranger");
    expect(
      await recordReferralEarning({
        referredShopId: stranger.shop.id,
        stripeInvoiceId: invoiceId(),
        invoiceAmountCents: 1999,
        currency: "usd",
      }),
    ).toBe(false);
  });

  it("reverses a refund by appending, and keeps the earning as evidence", async () => {
    const partner = await makePartner("refundref");
    const referred = await makeSeller("refundpayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    const invoice = invoiceId();
    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoice,
      invoiceAmountCents: 1999,
      currency: "usd",
    });

    expect(
      await reverseReferralEarning({ stripeInvoiceId: invoice, refundedCents: 1999 }),
    ).toBe(true);
    // A replayed refund is a replay, not a second clawback.
    expect(
      await reverseReferralEarning({ stripeInvoiceId: invoice, refundedCents: 1999 }),
    ).toBe(false);

    const rows = await getDb()
      .select()
      .from(referralEarnings)
      .where(eq(referralEarnings.stripeInvoiceId, invoice));

    // Two rows, not one edited row: the earning is still there.
    const cut = await share(1999);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amountCents).toSorted((a, b) => a - b)).toEqual([
      -cut,
      cut,
    ]);
    expect((await summaryFor(partner.partnerId)).lifetimeCents).toBe(0);
  });

  it("reverses fully across two partial refunds carrying a cumulative total", async () => {
    // The bug this pins: Stripe's `charge.amount_refunded` is cumulative, and
    // the reversal used to insert-or-drop on (invoice, kind), so a first
    // partial refund reversed its share and a later refund of the rest hit the
    // unique index and vanished — leaving commission owed on refunded money.
    const partner = await makePartner("partialref");
    const referred = await makeSeller("partialpayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    const invoice = invoiceId();
    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoice,
      invoiceAmountCents: 10_000,
      currency: "usd",
    });

    // Refund $20 of $100 (cumulative 2000), then the remaining $80
    // (cumulative 10000). The second call carries the running total.
    expect(
      await reverseReferralEarning({ stripeInvoiceId: invoice, refundedCents: 2000 }),
    ).toBe(true);
    expect(
      await reverseReferralEarning({ stripeInvoiceId: invoice, refundedCents: 10_000 }),
    ).toBe(true);

    // The whole commission is clawed back, not just the first slice.
    expect((await summaryFor(partner.partnerId)).lifetimeCents).toBe(0);

    const cut = await share(10_000);
    const rows = await getDb()
      .select()
      .from(referralEarnings)
      .where(eq(referralEarnings.stripeInvoiceId, invoice));
    // Still the earning plus one reversal — the reversal converged, it did not
    // multiply into a row per event.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amountCents).toSorted((a, b) => a - b)).toEqual([
      -cut,
      cut,
    ]);
  });

  it("never claws back more than it credited", async () => {
    const partner = await makePartner("overref");
    const referred = await makeSeller("overpayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    const invoice = invoiceId();
    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoice,
      invoiceAmountCents: 1000,
      currency: "usd",
    });

    // A refund larger than the invoice we commissioned — a credit applied on
    // top, say. The reversal is clamped to what was actually credited.
    await reverseReferralEarning({ stripeInvoiceId: invoice, refundedCents: 5000 });
    expect((await summaryFor(partner.partnerId)).lifetimeCents).toBe(0);
  });
});

describe("the hold period", () => {
  /*
   * The reason the hold exists: pay on day one and a day-nine refund claws
   * back money that is already in someone else's bank account.
   */
  it("withholds a fresh earning from the available balance", async () => {
    const partner = await makePartner("held");
    const referred = await makeSeller("heldpayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoiceId(),
      invoiceAmountCents: 100_000,
      currency: "usd",
    });

    const { holdDays } = await getProgramSettings();
    const summary = await summaryFor(partner.partnerId);
    const cut = await share(100_000);

    if (holdDays > 0) {
      expect(summary.heldCents).toBe(cut);
      expect(summary.availableCents).toBe(0);
      // Well over the minimum, and still not payable — the hold is the reason.
      expect(summary.payable).toBe(false);
    }
    expect(summary.unpaidCents).toBe(cut);
  });

  it("refuses to settle rows that are still inside the hold", async () => {
    const partner = await makePartner("heldsettle");
    const referred = await makeSeller("heldsettlepayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoiceId(),
      invoiceAmountCents: 100_000,
      currency: "usd",
    });

    const { holdDays } = await getProgramSettings();
    if (holdDays === 0) return;

    const settled = await markPaidManually(partner.partnerId, "staff@sailo.store");
    expect(settled.rows).toBe(0);
  });

  it("releases the balance once the hold has run", async () => {
    const partner = await makePartner("released");
    const referred = await makeSeller("releasedpayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoiceId(),
      invoiceAmountCents: 100_000,
      currency: "usd",
    });
    await matureEverything(partner.partnerId);

    const summary = await summaryFor(partner.partnerId);
    expect(summary.heldCents).toBe(0);
    expect(summary.availableCents).toBe(await share(100_000));
    expect(summary.payable).toBe(true);
  });
});

describe("settlement", () => {
  it("stamps every matured row once, and a second press stamps nothing", async () => {
    const partner = await makePartner("payout");
    const referred = await makeSeller("payoutpayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    for (let i = 0; i < 3; i++) {
      await recordReferralEarning({
        referredShopId: referred.shop.id,
        stripeInvoiceId: invoiceId(),
        invoiceAmountCents: 1999,
        currency: "usd",
      });
    }
    await matureEverything(partner.partnerId);

    const cut = await share(1999);
    const before = await summaryFor(partner.partnerId);
    expect(before.availableCents).toBe(cut * 3);

    const first = await markPaidManually(partner.partnerId, "staff@sailo.store");
    expect(first.rows).toBe(3);
    expect(first.cents).toBe(cut * 3);

    // The double click. Nothing left to stamp, and the first stamp stands.
    const second = await markPaidManually(partner.partnerId, "staff@sailo.store");
    expect(second.rows).toBe(0);

    const after = await summaryFor(partner.partnerId);
    expect(after.unpaidCents).toBe(0);
    expect(after.paidCents).toBe(cut * 3);
    expect(after.lifetimeCents).toBe(cut * 3);
  });

  it("leaves a later refund owing against a balance already paid out", async () => {
    const partner = await makePartner("clawback");
    const referred = await makeSeller("clawbackpayer");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    const invoice = invoiceId();
    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoice,
      invoiceAmountCents: 1999,
      currency: "usd",
    });
    await matureEverything(partner.partnerId);
    await markPaidManually(partner.partnerId, "staff@sailo.store");
    await reverseReferralEarning({ stripeInvoiceId: invoice, refundedCents: 1999 });

    /*
     * The honest answer: we are down one commission and the next invoice works
     * it off. Clamping this to zero would forgive money without anyone
     * deciding to.
     */
    const cut = await share(1999);
    const summary = await summaryFor(partner.partnerId);
    expect(summary.unpaidCents).toBe(-cut);
    expect(summary.paidCents).toBe(cut);
    expect(summary.lifetimeCents).toBe(0);

    // And the reversal is not itself stamped as paid — it has not been settled.
    const [reversal] = await getDb()
      .select()
      .from(referralEarnings)
      .where(
        and(
          eq(referralEarnings.stripeInvoiceId, invoice),
          eq(referralEarnings.kind, "reversal"),
        ),
      );
    expect(reversal?.paidOutAt).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  Getting paid without Stripe                                                */
/* -------------------------------------------------------------------------- */

/**
 * The partner who never connects Stripe.
 *
 * Every rule in the ledger above is about a partner Stripe can pay. This block
 * is about the one it can't — someone banking in a country we have not
 * verified, someone who declines Connect onboarding, someone stuck in
 * verification with a balance growing behind them. They earn on exactly the
 * same terms, and the money has to be able to reach them anyway.
 */

/* -------------------------------------------------------------------------- */
/*  The subscription requirement                                               */
/* -------------------------------------------------------------------------- */

/**
 * "You earn while you're a customer" — the rule the programme is built on.
 *
 * Two halves that must not be confused, and most of this block exists to keep
 * them apart:
 *
 *   - a lapsed partner stops *accruing*, immediately, at the next invoice;
 *   - a lapsed partner is still *paid* everything already in the ledger.
 *
 * Getting the first wrong pays commission to somebody who left. Getting the
 * second wrong keeps money somebody already earned. Neither is recoverable by
 * apologising afterwards.
 */
describe("the subscription requirement", () => {
  /** Puts a partner's own shop on a plan, the way billing would. */
  async function setPlan(
    shopId: string,
    plan: string,
    subscriptionStatus: string | null,
  ) {
    await getDb()
      .update(shops)
      .set({ plan, subscriptionStatus })
      .where(eq(shops.id, shopId));
  }

  async function referAndInvoice(
    partner: { code: string; partnerId: string },
    label: string,
    cents = 1999,
  ) {
    const referred = await makeSeller(label);
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });
    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoiceId(),
      invoiceAmountCents: cents,
      currency: "usd",
    });
    return referred;
  }

  it("earns while the partner is on a paid plan", async () => {
    const partner = await makePartner("subbed");
    await referAndInvoice(partner, "subbed-ref");

    expect((await summaryFor(partner.partnerId)).lifetimeCents).toBe(
      await share(1999),
    );
  });

  it("earns nothing once the partner cancels", async () => {
    const partner = await makePartner("cancelled");
    await setPlan(partner.shop.id, "free", "canceled");

    await referAndInvoice(partner, "cancelled-ref");

    expect((await summaryFor(partner.partnerId)).lifetimeCents).toBe(0);
  });

  /*
   * `past_due` is the one worth its own test. Stripe is still retrying, so the
   * money may yet arrive — but commission paid before it does comes out of
   * revenue we never received.
   */
  it("earns nothing while the partner's own payment is failing", async () => {
    const partner = await makePartner("pastdue");
    await setPlan(partner.shop.id, "pro", "past_due");

    await referAndInvoice(partner, "pastdue-ref");

    expect((await summaryFor(partner.partnerId)).lifetimeCents).toBe(0);
  });

  it("earns on a trial, before a penny has been charged", async () => {
    const partner = await makePartner("trialing");
    await setPlan(partner.shop.id, "pro", "trialing");

    await referAndInvoice(partner, "trialing-ref");

    expect((await summaryFor(partner.partnerId)).lifetimeCents).toBe(
      await share(1999),
    );
  });

  it("never earns for a partner with no shop to subscribe with", async () => {
    const writer = await makeShoplessPartner("noshop");
    await referAndInvoice(writer, "noshop-ref");

    expect((await summaryFor(writer.partnerId)).lifetimeCents).toBe(0);
  });

  /*
   * The rule stated as a sequence, because a gate checked only at approval
   * would pass every test above and still be wrong: earning has to stop and
   * restart with the subscription, invoice by invoice.
   */
  it("stops and resumes with the subscription, per invoice", async () => {
    const partner = await makePartner("resub");
    const referred = await makeSeller("resub-ref");
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredUserId: referred.userId,
      referredEmail: referred.email,
      rawCode: partner.code,
    });

    const bill = async () =>
      recordReferralEarning({
        referredShopId: referred.shop.id,
        stripeInvoiceId: invoiceId(),
        invoiceAmountCents: 1999,
        currency: "usd",
      });

    await bill(); // subscribed
    await setPlan(partner.shop.id, "free", "canceled");
    await bill(); // lapsed — earns nothing
    await setPlan(partner.shop.id, "pro", "active");
    await bill(); // back

    const cut = await share(1999);
    expect((await summaryFor(partner.partnerId)).lifetimeCents).toBe(cut * 2);
  });

  /*
   * Attribution deliberately survives a lapse. `creatorReferrals` is
   * first-touch with no second chance, so refusing the link would hand that
   * creator to nobody, permanently — and the partner would come back to
   * nothing after resubscribing.
   */
  it("still attributes a lapsed partner's link, so resubscribing recovers it", async () => {
    const partner = await makePartner("lapsedlink");
    await setPlan(partner.shop.id, "free", "canceled");

    const referred = await makeSeller("lapsedlink-ref");
    expect(
      await attributeReferral({
        referredShopId: referred.shop.id,
        referredUserId: referred.userId,
        referredEmail: referred.email,
        rawCode: partner.code,
      }),
    ).toBe("attributed");

    await setPlan(partner.shop.id, "pro", "active");
    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoiceId(),
      invoiceAmountCents: 1999,
      currency: "usd",
    });

    expect((await summaryFor(partner.partnerId)).lifetimeCents).toBe(
      await share(1999),
    );
  });

  /*
   * The other half of the rule, and the one that costs us money to get right.
   * Cancelling stops the tap; it does not empty the bucket.
   */
  it("still pays a lapsed partner what they already earned", async () => {
    const partner = await makePartner("owed");
    await referAndInvoice(partner, "owed-ref");
    await matureEverything(partner.partnerId);

    const owed = await share(1999);
    await setPlan(partner.shop.id, "free", "canceled");

    // Nothing about the balance moves when the subscription lapses.
    expect((await summaryFor(partner.partnerId)).availableCents).toBe(owed);

    const paid = await markPaidManually(partner.partnerId, "staff@sailo.store");
    expect(paid.cents).toBe(owed);
    expect((await summaryFor(partner.partnerId)).paidCents).toBe(owed);
  });
});
