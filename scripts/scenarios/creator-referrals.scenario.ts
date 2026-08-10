import { describe, expect, it, vi } from "vitest";
import type * as sessionModule from "@/lib/session";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { creatorReferrals, referralEarnings, shops, user } from "@/db/schema";
import {
  attributeReferral,
  ensureReferralCode,
  getReferralSummary,
  recordReferralEarning,
  reverseReferralEarning,
} from "@/lib/creator-referrals/store";
import { markReferralsPaid } from "@/lib/hq/referrals";
import { assertLocalDatabase } from "./local-only";

/**
 * The refer-a-creator ledger, against a real database.
 *
 * Unit tests pin the arithmetic; this pins the constraints — and the
 * constraints are where this feature actually lives. Every rule that stops
 * the programme paying out money it shouldn't is a unique index or a check
 * in `drizzle/0012_creator_referrals.sql`, and none of them can be exercised
 * without Postgres enforcing them:
 *
 *   - a second link never overwrites the first referrer
 *   - a replayed `invoice.paid` never earns twice
 *   - a refund appends rather than rewrites
 *   - a double-clicked payout stamps once
 *
 * Run with:
 *   ./scripts/scenarios/up.sh
 *   npx vitest run --config vitest.scenarios.mts \
 *     scripts/scenarios/creator-referrals.scenario.ts
 */

/*
 * `markReferralsPaid` guards itself with `requireStaff()` — deliberately, and
 * that guard is not what this file is testing. With no request there is no
 * session, so it would redirect to /hq/login before touching a row. Only that
 * one export is replaced; everything else in the module stays real, so a
 * future read that starts using it is not silently unguarded here.
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

/** A seller, with a shop, ready to refer or be referred. */
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
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  return { shop, email };
}

/** A Stripe invoice id that is unique per call, like a real one. */
const invoiceId = () => `in_scenario_${(seq += 1)}_${crypto.randomUUID().slice(0, 8)}`;

/** `ensureReferralCode` returns null only when it could not mint; not here. */
async function codeFor(shop: Parameters<typeof ensureReferralCode>[0]) {
  const code = await ensureReferralCode(shop);
  if (!code) throw new Error("fixture: no referral code was minted");
  return code;
}

describe("attribution", () => {
  it("records the referrer, once, and refuses a second link", async () => {
    const first = await makeSeller("first");
    const second = await makeSeller("second");
    const joiner = await makeSeller("joiner");

    const firstCode = await codeFor(first.shop);
    const secondCode = await codeFor(second.shop);

    expect(
      await attributeReferral({
        referredShopId: joiner.shop.id,
        referredEmail: joiner.email,
        rawCode: firstCode,
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
        referredEmail: joiner.email,
        rawCode: secondCode,
      }),
    ).toBe("already_referred");

    const rows = await getDb()
      .select()
      .from(creatorReferrals)
      .where(eq(creatorReferrals.referredShopId, joiner.shop.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.referrerShopId).toBe(first.shop.id);
    expect(rows[0]?.code).toBe(firstCode);
  });

  it("refuses a referrer using their own address, and stores nothing", async () => {
    const self = await makeSeller("self");
    const other = await makeSeller("selfother");
    const code = await codeFor(self.shop);

    expect(
      await attributeReferral({
        // A different shop, but the same person's email — the trivial
        // self-referral, and the one worth closing.
        referredShopId: other.shop.id,
        referredEmail: self.email.toUpperCase(),
        rawCode: code,
      }),
    ).toBe("self");

    expect(
      await getDb()
        .select()
        .from(creatorReferrals)
        .where(eq(creatorReferrals.referredShopId, other.shop.id)),
    ).toHaveLength(0);
  });

  it("treats an unknown or malformed code as no referral at all", async () => {
    const joiner = await makeSeller("unknown");

    for (const rawCode of ["ZZZZZZZZ", "nope", "' OR 1=1", "", null]) {
      expect(
        await attributeReferral({
          referredShopId: joiner.shop.id,
          referredEmail: joiner.email,
          rawCode,
        }),
      ).toMatch(/^(unknown_code|no_code)$/);
    }
  });

  it("keeps one code per shop however many times it is asked for", async () => {
    const seller = await makeSeller("stable");
    const first = await codeFor(seller.shop);
    // Re-read, so the second call cannot cheat off the in-memory row.
    const fresh = await getDb().query.shops.findFirst({
      where: eq(shops.id, seller.shop.id),
    });
    if (!fresh) throw new Error("fixture: shop vanished");
    expect(await codeFor(fresh)).toBe(first);
  });
});

describe("the ledger", () => {
  it("earns 20% once, however many times Stripe delivers the invoice", async () => {
    const referrer = await makeSeller("earner");
    const referred = await makeSeller("payer");
    const code = await codeFor(referrer.shop);
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredEmail: referred.email,
      rawCode: code,
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

    const summary = await getReferralSummary(referrer.shop.id);
    expect(summary.lifetimeCents).toBe(399);
    expect(summary.unpaidCents).toBe(399);
    expect(summary.referredCount).toBe(1);
    expect(summary.convertedCount).toBe(1);
    expect(summary.currency).toBe("USD");
  });

  it("stamps the conversion date once and never moves it", async () => {
    const referrer = await makeSeller("conv");
    const referred = await makeSeller("convpayer");
    const code = await codeFor(referrer.shop);
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredEmail: referred.email,
      rawCode: code,
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
    const referrer = await makeSeller("trialref");
    const referred = await makeSeller("trialpayer");
    const code = await codeFor(referrer.shop);
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredEmail: referred.email,
      rawCode: code,
    });

    expect(
      await recordReferralEarning({
        referredShopId: referred.shop.id,
        stripeInvoiceId: invoiceId(),
        invoiceAmountCents: 0,
        currency: "usd",
      }),
    ).toBe(false);

    const summary = await getReferralSummary(referrer.shop.id);
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
    const referrer = await makeSeller("refundref");
    const referred = await makeSeller("refundpayer");
    const code = await codeFor(referrer.shop);
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredEmail: referred.email,
      rawCode: code,
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
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amountCents).toSorted((a, b) => a - b)).toEqual([
      -399, 399,
    ]);
    expect((await getReferralSummary(referrer.shop.id)).lifetimeCents).toBe(0);
  });

  it("reverses fully across two partial refunds carrying a cumulative total", async () => {
    // The bug this pins: Stripe's `charge.amount_refunded` is cumulative, and
    // the reversal used to insert-or-drop on (invoice, kind), so a first
    // partial refund reversed its share and a later refund of the rest hit the
    // unique index and vanished — leaving commission owed on refunded money.
    const referrer = await makeSeller("partialref");
    const referred = await makeSeller("partialpayer");
    const code = await codeFor(referrer.shop);
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredEmail: referred.email,
      rawCode: code,
    });

    const invoice = invoiceId();
    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoice,
      invoiceAmountCents: 10_000, // earns 2000
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
    expect((await getReferralSummary(referrer.shop.id)).lifetimeCents).toBe(0);

    const rows = await getDb()
      .select()
      .from(referralEarnings)
      .where(eq(referralEarnings.stripeInvoiceId, invoice));
    // Still the earning plus one reversal — the reversal converged, it did not
    // multiply into a row per event.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amountCents).toSorted((a, b) => a - b)).toEqual([
      -2000, 2000,
    ]);
  });

  it("never claws back more than it credited", async () => {
    const referrer = await makeSeller("overref");
    const referred = await makeSeller("overpayer");
    const code = await codeFor(referrer.shop);
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredEmail: referred.email,
      rawCode: code,
    });

    const invoice = invoiceId();
    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoice,
      invoiceAmountCents: 1000, // earns 200
      currency: "usd",
    });

    // A refund larger than the invoice we commissioned — a credit applied on
    // top, say. The reversal is clamped to what was actually credited.
    await reverseReferralEarning({ stripeInvoiceId: invoice, refundedCents: 5000 });
    expect((await getReferralSummary(referrer.shop.id)).lifetimeCents).toBe(0);
  });
});

describe("payout", () => {
  it("stamps every unpaid row once, and a second press stamps nothing", async () => {
    const referrer = await makeSeller("payout");
    const referred = await makeSeller("payoutpayer");
    const code = await codeFor(referrer.shop);
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredEmail: referred.email,
      rawCode: code,
    });

    for (const amount of [1999, 1999, 1999]) {
      await recordReferralEarning({
        referredShopId: referred.shop.id,
        stripeInvoiceId: invoiceId(),
        invoiceAmountCents: amount,
        currency: "usd",
      });
    }

    const before = await getReferralSummary(referrer.shop.id);
    expect(before.unpaidCents).toBe(399 * 3);
    expect(before.payable).toBe(false); // 1197 is under the $25 minimum

    const first = await markReferralsPaid(referrer.shop.id);
    expect(first.rows).toBe(3);
    expect(first.cents).toBe(399 * 3);

    // The double click. Nothing left to stamp, and the first stamp stands.
    const second = await markReferralsPaid(referrer.shop.id);
    expect(second.rows).toBe(0);

    const after = await getReferralSummary(referrer.shop.id);
    expect(after.unpaidCents).toBe(0);
    expect(after.paidCents).toBe(399 * 3);
    expect(after.lifetimeCents).toBe(399 * 3);
  });

  it("leaves a later refund owing against a balance already paid out", async () => {
    const referrer = await makeSeller("clawback");
    const referred = await makeSeller("clawbackpayer");
    const code = await codeFor(referrer.shop);
    await attributeReferral({
      referredShopId: referred.shop.id,
      referredEmail: referred.email,
      rawCode: code,
    });

    const invoice = invoiceId();
    await recordReferralEarning({
      referredShopId: referred.shop.id,
      stripeInvoiceId: invoice,
      invoiceAmountCents: 1999,
      currency: "usd",
    });
    await markReferralsPaid(referrer.shop.id);
    await reverseReferralEarning({ stripeInvoiceId: invoice, refundedCents: 1999 });

    /*
     * The honest answer: we are down 399 and the next invoice works it off.
     * Clamping this to zero would forgive money without anyone deciding to.
     */
    const summary = await getReferralSummary(referrer.shop.id);
    expect(summary.unpaidCents).toBe(-399);
    expect(summary.paidCents).toBe(399);
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
