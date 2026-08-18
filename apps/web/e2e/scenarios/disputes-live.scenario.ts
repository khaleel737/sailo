import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";
import { getDb } from "@sailo/db";
import { disputes, shops, user, type Shop } from "@sailo/db/schema";
import { handleDisputeEvent } from "@/lib/stripe-webhooks";
import {
  evidenceFileUrl,
  holdPayouts,
  normalizeDispute,
  readPayoutState,
  releasePayouts,
  retrieveDispute,
  submitEvidence,
  uploadEvidenceFile,
} from "@sailo/payments/disputes";
import { assembleEvidence } from "@sailo/core/disputes";
import { releaseHold, shopDisputeStats } from "@sailo/commerce/disputes";

/**
 * Chargebacks against real Stripe.
 *
 * `disputes.scenario.ts` constructs every event by hand. That proves the handlers
 * make the right decisions and proves nothing about whether Stripe still
 * *produces* those shapes — and this feature reads four fields that are either
 * undocumented in the place you would look for them or absent on some disputes:
 *
 *   - `payment_method_details.card.case_type`, which is the only thing
 *     separating an inquiry from a chargeback, and which is absent entirely on
 *     every non-card dispute;
 *   - `balance_transactions[].net`, which is the only place the real cost
 *     appears — a $42 chargeback is `-5700`, because Stripe also takes $15;
 *   - `evidence_details.due_by`, in epoch **seconds**, which as milliseconds puts
 *     every deadline in 1970 and reads as past due;
 *   - `enhanced_eligibility_types`, which is how Visa says a fraud case can be
 *     won by rule rather than by argument.
 *
 * All four fail silently if Stripe moves them. So this drives the application's
 * own modules against a real connected account and asserts on what comes back.
 *
 * Needs `STRIPE_CONNECT_ACCOUNT`: a test connected account with
 * `charges_enabled`. Skipped entirely without one, so the ordinary scenario
 * suite stays offline.
 *
 *   STRIPE_CONNECT_ACCOUNT=acct_… npx dotenv -e ../../.env.local.test -- \
 *     npx vitest run --config vitest.scenarios.mts \
 *     e2e/scenarios/disputes-live.scenario.ts
 *
 * It creates real disputes on that account. They are test-mode and free, but
 * they are permanent — the account accumulates them, and its dispute rate in the
 * Stripe dashboard is not a number anybody should read afterwards.
 */

const ACCOUNT = process.env.STRIPE_CONNECT_ACCOUNT;
const db = getDb();
const uid = () => crypto.randomUUID();

describe.skipIf(!ACCOUNT)("chargebacks against real Stripe", () => {
  const acting = { stripeAccount: ACCOUNT as string };
  let stripe: Stripe;
  let shop: Shop;

  beforeAll(async () => {
    assertLocalDatabase();

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key?.startsWith("sk_test")) {
      throw new Error("refusing to run without a test-mode secret key");
    }
    stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

    await purgeFixtures(["live-dispute-"]);

    /*
     * Claim the connected account exclusively, first.
     *
     * With no order to match, a dispute's shop is resolved from its account —
     * and nothing makes `shops.stripeAccountId` unique (see the note on the
     * column). Earlier runs of this suite leave their fixture shops behind, so
     * without this the disputes raised below are filed against whichever shop
     * `locate` picks, which is deliberately the *oldest* one: stable, and not
     * this one. Three assertions failed on exactly that before this existed,
     * which is a fair argument for making the column unique.
     */
    await db
      .update(shops)
      .set({ stripeAccountId: null, stripeChargesEnabled: false })
      .where(eq(shops.stripeAccountId, ACCOUNT as string));

    const userId = uid();
    await db.insert(user).values({
      id: userId,
      name: "Live Dispute Seller",
      email: `live-dispute-${userId.slice(0, 8)}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [row] = await db
      .insert(shops)
      .values({
        userId,
        handle: `live-dispute-${userId.slice(0, 8)}`,
        name: "Live Dispute Shop",
        currency: "USD",
        isPublished: true,
        plan: "business",
        stripeAccountId: ACCOUNT as string,
        stripeChargesEnabled: true,
      })
      .returning();
    shop = row!;
  });

  /** A charge Stripe disputes the moment it settles. */
  async function disputedCharge(amountCents: number, card: string) {
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        payment_method: card,
        confirm: true,
        off_session: true,
        description: "Sailo live dispute scenario",
      },
      acting,
    );

    // Stripe raises the dispute a moment after the charge settles.
    for (let attempt = 0; attempt < 20; attempt++) {
      const list = await stripe.disputes.list(
        { charge: intent.latest_charge as string, limit: 1 },
        acting,
      );
      if (list.data[0]) return { intent, dispute: list.data[0] };
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Stripe raised no dispute for the test card");
  }

  /** The webhook Stripe would have delivered, from the object it actually made. */
  const eventFor = (dispute: Stripe.Dispute, type: string): Stripe.Event =>
    ({
      id: `evt_${uid().replace(/-/g, "")}`,
      type,
      created: dispute.created,
      account: ACCOUNT,
      data: { object: dispute },
    }) as unknown as Stripe.Event;

  it("tells a chargeback from an inquiry, and prices each correctly", async () => {
    /*
     * The two shapes side by side, from Stripe rather than from a fixture. Every
     * assertion below was a decision the first version of the handler got wrong.
     */
    const [chargeback, inquiry] = await Promise.all([
      disputedCharge(4_200, "pm_card_createDispute"),
      disputedCharge(1_900, "pm_card_createDisputeInquiry"),
    ]);

    const cb = normalizeDispute(chargeback.dispute);
    expect(cb.caseType).toBe("chargeback");
    expect(cb.status).toBe("needs_response");
    expect(cb.inquiry).toBe(false);
    expect(cb.fundsOut).toBe(true);
    // $42 plus a $15 dispute fee. `dispute.amount` alone understates it by 36%.
    expect(cb.amountCents).toBe(4_200);
    expect(cb.feeCents).toBe(1_500);
    expect(cb.deductedCents).toBe(5_700);
    // Visa's fraud code, which is the one CE3.0 can answer.
    expect(cb.networkReasonCode).toBe("10.4");

    const inq = normalizeDispute(inquiry.dispute);
    expect(inq.caseType).toBe("inquiry");
    expect(inq.status).toBe("warning_needs_response");
    expect(inq.inquiry).toBe(true);
    expect(inq.fundsOut).toBe(false);
    // Nothing has moved. The old handler marked the order disputed anyway.
    expect(inq.deductedCents).toBe(0);
    expect(inq.feeCents).toBe(0);
    expect(inquiry.dispute.balance_transactions).toHaveLength(0);
    expect(inquiry.dispute.is_charge_refundable).toBe(true);
  });

  it("reads the response deadline as a date in the future", async () => {
    /*
     * Stripe sends epoch **seconds**. Read as milliseconds, every deadline lands
     * in January 1970 — which renders as past due on every surface and tells a
     * seller a live case is already lost.
     */
    const { dispute } = await disputedCharge(2_500, "pm_card_createDispute");
    const read = normalizeDispute(dispute);

    expect(read.dueBy).toBeInstanceOf(Date);
    expect(read.dueBy!.getTime()).toBeGreaterThan(Date.now());
    // Networks give 20-ish days; anything past a year means the units are wrong.
    expect(read.dueBy!.getTime()).toBeLessThan(Date.now() + 400 * 86_400_000);
  });

  it("records one row, whatever Stripe delivers", async () => {
    const { dispute } = await disputedCharge(3_300, "pm_card_createDispute");

    for (const type of [
      "charge.dispute.created",
      "charge.dispute.funds_withdrawn",
      "charge.dispute.updated",
    ]) {
      await handleDisputeEvent(eventFor(dispute, type), ACCOUNT as string);
    }

    const rows = await db
      .select()
      .from(disputes)
      .where(eq(disputes.stripeDisputeId, dispute.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deductedCents).toBe(3_300 + 1_500);
    expect(rows[0]?.shopId).toBe(shop.id);
  });

  it("submits evidence Stripe accepts", async () => {
    /*
     * The assembled payload, posted for real. A field name Stripe does not know
     * is a 400 for the *whole* submission — losing the fields that were right
     * along with the one that was not — so this is the only way to know the
     * assembly produces a valid document.
     */
    const { dispute } = await disputedCharge(2_100, "pm_card_createDispute");

    const evidence = assembleEvidence("fraudulent", {
      customerName: "Ada Lovelace",
      customerEmail: "ada@example.com",
      buyerIp: "203.0.113.42",
      buyerUserAgent: "Mozilla/5.0",
      buyerDeviceFingerprint: null,
      buyerAccountId: "client_7f3a",
      billingAddress: "12 Bridge St, Bristol, BS1 4ND, GB",
      shippingAddress: "12 Bridge St, Bristol, BS1 4ND, GB",
      productDescription: "1 × Speckled Mug",
      soldKind: "physical",
      currency: "USD",
      totalCents: 2_100,
      orderReference: "INV-0007",
      placedAt: new Date(),
      shippingCarrier: "Royal Mail",
      shippingTrackingNumber: "RM123456789GB",
      shippedAt: new Date(),
      serviceAt: null,
      accessLog: [],
      termsAcceptedAt: new Date(),
      refundPolicyText: null,
      refundPolicyUrl: "https://example.com/terms",
      cancellationPolicyText: null,
      refundedCents: 0,
      refundedAt: null,
      refundRefusalExplanation: null,
      duplicateChargeId: null,
      duplicateIsDistinct: false,
      cancelledAt: null,
      customerCommunicationSummary: null,
      files: {},
    });

    const result = await submitEvidence({
      disputeId: dispute.id,
      accountId: ACCOUNT as string,
      evidence,
      /*
       * `submit: false`. Stripe accepts one *submitted* response per dispute and
       * closing this one would end the case; staging it proves the document is
       * valid, which is what is under test.
       */
      submit: false,
    });

    expect(result.ok, "ok" in result ? "" : (result as { error: string }).error).toBe(true);
    if (!result.ok) return;

    const back = await retrieveDispute(dispute.id, ACCOUNT as string);
    expect(back?.hasEvidence).toBe(true);
  });

  /**
   * A real PDF, built rather than fixtured — and structurally valid, which is
   * the whole difficulty.
   *
   * Stripe parses the file rather than trusting the declared type: a plain
   * string beginning `%PDF-1.4` is refused with "the file you uploaded is not
   * supported", which is what the first version of this test did and what it
   * caught. So the cross-reference table is emitted with real byte offsets. It
   * matters beyond the test — it is the reason a seller who exports a damaged
   * scan gets a refusal from Stripe rather than a submission that fails later.
   */
  function tinyPdf(): Uint8Array {
    const objects = [
      "<</Type/Catalog/Pages 2 0 R>>",
      "<</Type/Pages/Kids[3 0 R]/Count 1>>",
      "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<<>>>>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(pdf);
  }

  it("uploads a document to the connected account and attaches it as evidence", async () => {
    /*
     * The end of the chain, and the part that fails latest and most quietly.
     *
     * File ids are account-scoped. A proof of delivery uploaded to the platform
     * is rejected by a connected account's `disputes.update` with an error
     * naming `evidence[shipping_documentation]` — so it reads as a malformed
     * evidence field rather than as a file on the wrong account, and gets
     * debugged in the assembler for a day. Nothing but a real upload against a
     * real connected dispute proves the two agree.
     */
    const { dispute } = await disputedCharge(2_400, "pm_card_createDispute");

    const uploaded = await uploadEvidenceFile({
      accountId: ACCOUNT as string,
      filename: "proof-of-delivery.pdf",
      contentType: "application/pdf",
      bytes: tinyPdf(),
    });

    expect(
      uploaded.ok,
      uploaded.ok ? "" : uploaded.error,
    ).toBe(true);
    if (!uploaded.ok) return;

    expect(uploaded.file.stripeFileId).toMatch(/^file_/);
    /* Stripe's own byte count, which is what the 4.5 MB ceiling is measured against. */
    expect(uploaded.file.bytes).toBeGreaterThan(0);

    const evidence = assembleEvidence("product_not_received", {
      customerName: "Ada Lovelace",
      customerEmail: "ada@example.com",
      buyerIp: "203.0.113.42",
      buyerUserAgent: "Mozilla/5.0",
      buyerDeviceFingerprint: null,
      buyerAccountId: "client_7f3a",
      billingAddress: "12 Bridge St, Bristol, BS1 4ND, GB",
      shippingAddress: "12 Bridge St, Bristol, BS1 4ND, GB",
      productDescription: "1 × Speckled Mug",
      soldKind: "physical",
      currency: "USD",
      totalCents: 2_400,
      orderReference: "INV-0008",
      placedAt: new Date(),
      shippingCarrier: "Royal Mail",
      shippingTrackingNumber: "RM123456789GB",
      shippedAt: new Date(),
      serviceAt: null,
      accessLog: [],
      termsAcceptedAt: new Date(),
      refundPolicyText: null,
      refundPolicyUrl: "https://example.com/terms",
      cancellationPolicyText: null,
      refundedCents: 0,
      refundedAt: null,
      refundRefusalExplanation: null,
      duplicateChargeId: null,
      duplicateIsDistinct: false,
      cancelledAt: null,
      customerCommunicationSummary: null,
      /* The whole point: a file id where the assembler expects one. */
      files: { shipping_documentation: uploaded.file.stripeFileId },
    });

    /*
     * It has to arrive as a file id and not as text. A sentence in a file field
     * is a 400 for the entire update, and the assembler keeps the two apart
     * precisely so this cannot happen — so assert it did.
     */
    expect(evidence.fileIds.shipping_documentation).toBe(uploaded.file.stripeFileId);
    expect(evidence.payload).not.toHaveProperty("shipping_documentation");

    const result = await submitEvidence({
      disputeId: dispute.id,
      accountId: ACCOUNT as string,
      evidence,
      /* Staged, not sent: proves Stripe accepts the document without ending the case. */
      submit: false,
    });

    expect(result.ok, result.ok ? "" : result.error).toBe(true);
    if (!result.ok) return;

    /*
     * Read it back off the dispute. `ok: true` only says the request was
     * accepted; this says the file is on the case Stripe will show an issuer.
     */
    const live = await stripe.disputes.retrieve(dispute.id, {}, acting);
    expect(live.evidence.shipping_documentation).toBe(uploaded.file.stripeFileId);
    expect(live.evidence.shipping_tracking_number).toBe("RM123456789GB");
  });

  it("refuses a file type the card networks do not accept", async () => {
    /*
     * Checked before the bytes leave, because Stripe's Files API has no delete:
     * a document uploaded and then rejected is a permanent orphan on the
     * seller's own account, one for every mistake they make.
     */
    const refused = await uploadEvidenceFile({
      accountId: ACCOUNT as string,
      filename: "notes.txt",
      contentType: "text/plain",
      bytes: new TextEncoder().encode("hello"),
    });
    expect(refused.ok).toBe(false);
  });

  it("serves a link to a document staff can actually look at", async () => {
    /*
     * Evidence is reviewed before it is sent, and a staff member cannot review
     * a `file_1Abc…`. Stripe serves the bytes only through a FileLink, so the
     * preview on the evidence page depends on this working on the *connected*
     * account rather than the platform.
     */
    const uploaded = await uploadEvidenceFile({
      accountId: ACCOUNT as string,
      filename: "receipt.pdf",
      contentType: "application/pdf",
      bytes: tinyPdf(),
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const url = await evidenceFileUrl(uploaded.file.stripeFileId, ACCOUNT as string);
    expect(url).toMatch(/^https:\/\//);
  });

  it("holds and releases payouts on the real account", async () => {
    /*
     * The reversible move, against Stripe rather than a stub.
     *
     * `payouts_enabled` is read-only and stays true throughout — the capability
     * is intact and the shop keeps trading. What changes is the *schedule*, and
     * that is the whole design: a held seller keeps selling and keeps accruing a
     * balance a chargeback can still be debited from.
     */
    const before = await readPayoutState(ACCOUNT as string);
    expect(before).not.toBeNull();

    const held = await holdPayouts(ACCOUNT as string);
    expect(held.ok).toBe(true);

    const during = await readPayoutState(ACCOUNT as string);
    expect(during?.interval).toBe("manual");
    expect(during?.held).toBe(true);
    // The capability, untouched. This is not a suspension.
    expect(during?.enabled).toBe(true);

    const restored = held.ok ? held.previousInterval : null;
    const released = await releasePayouts(ACCOUNT as string, restored);
    expect(released.ok).toBe(true);

    const after = await readPayoutState(ACCOUNT as string);
    expect(after?.held).toBe(false);
    // Back to what the seller had, not to a guess.
    if (restored && restored !== "manual") expect(after?.interval).toBe(restored);
  });

  it("holds payouts from a real chargeback, and a person can release them", async () => {
    /*
     * The whole loop: Stripe raises a dispute, the webhook records it, the shop
     * is reassessed, the payout is held on the real account — and a human
     * releases it, which restores the seller's own interval and writes the
     * clearance that stops the next assessment re-applying it.
     */
    const { dispute } = await disputedCharge(60_000, "pm_card_createDispute");
    await handleDisputeEvent(
      eventFor(dispute, "charge.dispute.created"),
      ACCOUNT as string,
    );

    const flagged = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(flagged?.payoutsPausedAt).not.toBeNull();
    expect(flagged?.payoutsPausedReason).toContain("Sailo would cover");
    // The storefront is untouched. That is the point of the ordering.
    expect(flagged?.suspendedAt).toBeNull();
    expect(flagged?.isPublished).toBe(true);
    expect((await readPayoutState(ACCOUNT as string))?.held).toBe(true);

    const released = await releaseHold(flagged!, { clear: true });
    expect(released.ok).toBe(true);

    const cleared = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(cleared?.payoutsPausedAt).toBeNull();
    expect(cleared?.disputeClearedAt).not.toBeNull();
    expect((await readPayoutState(ACCOUNT as string))?.held).toBe(false);
  });

  it("counts what it recorded, in the bucket that can honestly hold it", async () => {
    /*
     * None of the disputes above has a Sailo order behind it — they were raised
     * on charges created directly against the connected account, which is
     * exactly the case a seller taking payments from Stripe's own dashboard
     * produces.
     *
     * So they cannot appear in `allTally`, which is built by joining from
     * `orders` and grouping by the order's month: there is no order and
     * therefore no denominator. Asserting they did was this test's first
     * mistake, and chasing it is what surfaced the real one — before
     * `unattributedChargebacks` existed these disputes were counted *nowhere*,
     * and a shop running 20% fraud outside its own checkout read as clean.
     *
     * They are counted, not divided, and they reach the escalation through
     * `emergingChargebacks` — the same route as a cohort too young to measure.
     */
    const stats = await shopDisputeStats(shop.id);

    expect(stats.unattributedChargebacks).toBeGreaterThan(0);
    expect(stats.emergingChargebacks).toBeGreaterThanOrEqual(
      stats.unattributedChargebacks,
    );
    // No orders, so no rate — and correctly so, rather than a comforting zero.
    expect(stats.chargebackBp).toBeNull();

    // The money is real even where the rate cannot be.
    expect(stats.openDisputeCents).toBeGreaterThan(0);
    expect(stats.awaitingResponse).toBeGreaterThan(0);
  });
});
