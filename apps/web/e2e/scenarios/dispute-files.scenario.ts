import type * as disputesApi from "@sailo/payments/disputes";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  disputeEvidenceFiles,
  disputes,
  orderItems,
  orders,
  paymentMethods,
  shops,
  user,
} from "@sailo/db/schema";

/**
 * The documents a dispute is answered with, against real rows.
 *
 * Everything in `files.ts` that a unit test can reach is already covered by
 * `packages/core/src/disputes/files.test.ts`. What it cannot reach is the part
 * that decides whether the feature works at all:
 *
 *   - whether an uploaded file actually *closes the gap* the evidence assembler
 *     reports, on both the staff view and the seller's own panel;
 *   - whether the file id reaches the payload Stripe is handed;
 *   - whether the 4.5 MB ceiling is applied before the bytes leave, so a refused
 *     document does not become a permanent orphan on the seller's account;
 *   - whether a second upload to one field replaces rather than duplicates,
 *     which Postgres decides and no unit test can observe.
 *
 * The Stripe seam is stubbed — this fixture has no account to upload to — and
 * every call it receives is recorded, so the assertions can be about what would
 * have been sent rather than about what was returned.
 */

/** Uploads that reached the Stripe seam, in order. */
const uploads: {
  accountId: string | null;
  filename: string;
  contentType: string;
  bytes: number;
}[] = [];

/** Evidence submissions that reached Stripe, in order. */
const submissions: { fileIds: Record<string, string>; submit: boolean }[] = [];

let uploadSucceeds = true;

/*
 * Both doors. `requireUser` is the seller's and `requireStaff` is HQ's, and the
 * route below picks between them from the form — so the seller tests need a
 * session whose id can be made to match, or not match, the fixture shop's owner.
 */
let sessionUserId = "nobody";

vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireStaff: async () => ({ id: "staff", email: "staff@sailo.test" }),
  requireUser: async () => ({ id: sessionUserId, email: "seller@example.com" }),
}));

vi.mock("@sailo/payments/disputes", async (importOriginal) => {
  const actual = await importOriginal<typeof disputesApi>();
  return {
    ...actual,
    uploadEvidenceFile: async (opts: {
      accountId: string | null;
      filename: string;
      contentType: string;
      bytes: Uint8Array;
    }) => {
      uploads.push({
        accountId: opts.accountId,
        filename: opts.filename,
        contentType: opts.contentType,
        bytes: opts.bytes.byteLength,
      });
      return uploadSucceeds
        ? {
            ok: true as const,
            file: {
              stripeFileId: `file_${uploads.length}_${opts.filename.replace(/\W/g, "")}`,
              filename: opts.filename,
              contentType: opts.contentType as "application/pdf",
              bytes: opts.bytes.byteLength,
            },
          }
        : { ok: false as const, error: "stripe said no" };
    },
    /*
     * A dispute Stripe would accept a response for. `respondToDispute` reads the
     * live object rather than our row — deliberately, since the deadline is
     * Stripe's — so it has to exist for the submission path to run at all.
     */
    retrieveDispute: async (id: string) => ({
      id,
      status: "needs_response",
      reason: "product_not_received",
      amountCents: 4200,
      feeCents: 0,
      deductedCents: 0,
      currency: "USD",
      dueBy: new Date(Date.now() + 10 * 86_400_000),
      submissionCount: 0,
      caseType: "chargeback" as const,
      network: "visa",
      networkReasonCode: "13.1",
      enhancedEligibilityTypes: [],
      chargeId: "ch_x",
      paymentIntentId: "pi_x",
      createdAt: new Date(),
    }),
    evidenceFileUrl: async (fileId: string) =>
      `https://files.stripe.com/links/${fileId}`,
    submitEvidence: async (opts: {
      evidence: { fileIds: Record<string, string> };
      submit: boolean;
    }) => {
      submissions.push({ fileIds: opts.evidence.fileIds, submit: opts.submit });
      return {
        ok: true as const,
        dispute: {
          status: opts.submit ? "under_review" : "needs_response",
          submissionCount: opts.submit ? 1 : 0,
        },
      };
    },
  };
});

const {
  attachEvidenceFile,
  detachEvidenceFile,
  disputeReadiness,
  evidenceFileIdsFor,
  evidenceFilesFor,
  respondToDispute,
} = await import("@sailo/commerce/disputes");
const { getSellerDisputes } = await import("@/lib/seller-disputes");
const { POST: uploadRoute } = await import(
  "@/app/api/disputes/[id]/evidence/route"
);
const { GET: previewRoute } = await import(
  "@/app/api/disputes/[id]/evidence/[field]/route"
);

const db = getDb();
const uid = () => crypto.randomUUID();
const ACCOUNT = "acct_files_seller";

const PDF = "application/pdf";
const bytes = (n: number) => new Uint8Array(n).fill(7);

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures(["dfile-"]);
});

beforeEach(() => {
  uploads.length = 0;
  submissions.length = 0;
  uploadSucceeds = true;
  sessionUserId = "nobody";
});

/** Post a document at the route the browser actually posts to. */
async function postFile(opts: {
  disputeId: string;
  field: string;
  filename: string;
  contentType: string;
  size: number;
  as: "staff" | "seller";
}) {
  const form = new FormData();
  form.set("field", opts.field);
  form.set("as", opts.as);
  form.set(
    "file",
    new File([bytes(opts.size)], opts.filename, { type: opts.contentType }),
  );

  const response = await uploadRoute(
    new Request(`http://localhost/api/disputes/${opts.disputeId}/evidence`, {
      method: "POST",
      body: form,
    }),
    { params: Promise.resolve({ id: opts.disputeId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function fixture(over: { productKind?: string; shipped?: boolean } = {}) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `dfile-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  /*
   * One live holder per connected account — the uniqueness 0064 gives
   * production holds in scenarios too. Earlier tests' fixture shops release
   * the account the way a real reconnect would.
   */
  await db
    .update(shops)
    .set({ stripeAccountId: null })
    .where(eq(shops.stripeAccountId, ACCOUNT));
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `dfile-${userId.slice(0, 8)}`,
      name: "Parcel Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      stripeAccountId: ACCOUNT,
      stripeChargesEnabled: true,
    })
    .returning();
  if (!shop) throw new Error("fixture: no shop");

  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "card",
    label: "card",
    config: {} as never,
    isEnabled: true,
    position: 0,
  });

  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      productTitle: "Speckled Mug",
      productKind: over.productKind ?? "physical",
      quantity: 1,
      unitPriceCents: 4200,
      subtotalCents: 4200,
      totalCents: 4200,
      currency: "USD",
      customerName: "Ada Lovelace",
      customerEmail: `ada-${uid().slice(0, 8)}@example.com`,
      addressLine1: "12 Bridge St",
      city: "Bristol",
      postalCode: "BS1 4ND",
      country: "GB",
      buyerIp: "203.0.113.42",
      termsAcceptedAt: new Date(),
      paymentMethod: "card",
      paymentStatus: "disputed",
      status: "confirmed",
      stripePaymentIntentId: `pi_${uid().replace(/-/g, "")}`,
      stripeAccountId: ACCOUNT,
      /*
       * A "never arrived" case wants the carrier, the tracking number and the
       * date as well as the document. An unshipped order is legitimately not
       * ready however many files are attached, so the test that asserts on
       * readiness has to ship it.
       */
      ...(over.shipped
        ? {
            trackingCarrier: "Royal Mail",
            trackingNumber: "RM123456789GB",
            shippedAt: new Date(Date.now() - 5 * 86_400_000),
          }
        : {}),
    })
    .returning();
  if (!order) throw new Error("fixture: no order");

  await db.insert(orderItems).values({
    orderId: order.id,
    title: "Speckled Mug",
    kind: over.productKind ?? "physical",
    unitPriceCents: 4200,
    quantity: 1,
    subtotalCents: 4200,
    position: 0,
  });

  const [dispute] = await db
    .insert(disputes)
    .values({
      scope: "connected",
      shopId: shop.id,
      orderId: order.id,
      stripeDisputeId: `du_${uid().replace(/-/g, "")}`,
      stripeChargeId: `ch_${uid().replace(/-/g, "")}`,
      stripePaymentIntentId: order.stripePaymentIntentId,
      stripeAccountId: ACCOUNT,
      amountCents: 4200,
      currency: "USD",
      /* "Buyer says it never arrived" — the case a proof of delivery decides. */
      reason: "product_not_received",
      status: "needs_response",
      dueBy: new Date(Date.now() + 10 * 86_400_000),
      stripeCreatedAt: new Date(),
    })
    .returning();
  if (!dispute) throw new Error("fixture: no dispute");

  return { shop, order, dispute };
}

describe("attaching a document", () => {
  it("uploads to the dispute's own connected account", async () => {
    /*
     * The mistake that makes an evidence pipeline look like it works. File ids
     * are account-scoped: a proof of delivery uploaded to the platform is
     * rejected by a connected account's `disputes.update`, with an error naming
     * the *evidence field* rather than the account — so it reads as a bug in the
     * assembler and gets debugged in the wrong file for a day.
     */
    const { dispute } = await fixture();

    const result = await attachEvidenceFile({
      disputeId: dispute.id,
      field: "shipping_documentation",
      filename: "delivery.pdf",
      contentType: PDF,
      bytes: bytes(1_000),
      uploadedBy: "staff@sailo.test",
    });

    expect(result.ok).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.accountId).toBe(ACCOUNT);
  });

  it("closes the gap the evidence assembler reported", async () => {
    /*
     * The whole point of the feature. Before this pass `holdings.files` was a
     * hardcoded `{}`, so `shipping_documentation` was permanently reported as
     * outstanding on every physical dispute and no surface in the product could
     * satisfy it.
     */
    const { dispute } = await fixture();

    const before = await disputeReadiness(dispute.id);
    const gapBefore = before?.evidence.fields.find(
      (f) => f.field === "shipping_documentation",
    );
    expect(gapBefore?.status).not.toBe("held");

    await attachEvidenceFile({
      disputeId: dispute.id,
      field: "shipping_documentation",
      filename: "delivery.pdf",
      contentType: PDF,
      bytes: bytes(1_000),
      uploadedBy: "staff@sailo.test",
    });

    const after = await disputeReadiness(dispute.id);
    const gapAfter = after?.evidence.fields.find(
      (f) => f.field === "shipping_documentation",
    );
    expect(gapAfter?.status).toBe("held");
    expect(after?.evidence.completenessBp).toBeGreaterThan(
      before?.evidence.completenessBp ?? 0,
    );
  });

  it("puts the file id into what Stripe is actually handed", async () => {
    /*
     * A row that never reaches the payload is a document nobody sends. This is
     * the assertion that the whole chain — row, holdings merge, assembly,
     * submission — is connected end to end.
     */
    const { dispute } = await fixture();
    await attachEvidenceFile({
      disputeId: dispute.id,
      field: "shipping_documentation",
      filename: "delivery.pdf",
      contentType: PDF,
      bytes: bytes(1_000),
      uploadedBy: "staff@sailo.test",
    });

    const result = await respondToDispute({ disputeId: dispute.id, submit: true });
    expect(result.ok).toBe(true);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.fileIds.shipping_documentation).toMatch(/^file_/);
    expect(submissions[0]?.submit).toBe(true);
  });

  it("shows the seller the case is ready once they supply it", async () => {
    /*
     * The seller's panel computes its gaps independently of /hq's. A merge done
     * in one and not the other is the version of this bug that survives review:
     * staff see a complete case, the seller is still being told to send a
     * document they already sent, and they learn to ignore the panel.
     */
    const { shop, dispute } = await fixture({ shipped: true });

    const before = await getSellerDisputes(shop.id);
    expect(before[0]?.ready).toBe(false);
    expect(before[0]?.uploads.some((u) => u.field === "shipping_documentation")).toBe(
      true,
    );

    await attachEvidenceFile({
      disputeId: dispute.id,
      field: "shipping_documentation",
      filename: "delivery.pdf",
      contentType: PDF,
      bytes: bytes(1_000),
      uploadedBy: "seller@example.com",
    });

    const after = await getSellerDisputes(shop.id);
    expect(after[0]?.ready).toBe(true);
    expect(
      after[0]?.uploads.find((u) => u.field === "shipping_documentation")?.attached
        ?.filename,
    ).toBe("delivery.pdf");
  });
});

describe("the route the browser actually posts to", () => {
  /*
   * A route handler and not a server action, because **server actions cap the
   * request body at 1 MB** and the card networks accept 4.5 MB. Every test in
   * this block is about that seam: the version of this feature that used an
   * action typechecked, passed every test above, and failed in production on the
   * first scanned proof of delivery anybody uploaded.
   */

  it("accepts a document far larger than a server action would", async () => {
    const { shop, dispute } = await fixture();
    sessionUserId = shop.userId;

    const result = await postFile({
      disputeId: dispute.id,
      field: "shipping_documentation",
      filename: "scan.pdf",
      contentType: PDF,
      /* 3 MB: legal evidence, and triple what a server action would take. */
      size: 3_000_000,
      as: "seller",
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(uploads[0]?.bytes).toBe(3_000_000);
  });

  it("lets a seller attach to their own dispute", async () => {
    const { shop, dispute } = await fixture();
    sessionUserId = shop.userId;

    const result = await postFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "receipt.pdf",
      contentType: PDF,
      size: 2_000,
      as: "seller",
    });

    expect(result.status).toBe(200);
    expect((await evidenceFilesFor(dispute.id))[0]?.uploadedBy).toBe(
      "seller@example.com",
    );
  });

  it("refuses a seller reaching for somebody else's dispute", async () => {
    /*
     * The whole of the attack surface here. Ownership is re-derived from the
     * dispute row; the id in the URL is a claim and nothing more. Without this
     * a seller could put a document on a stranger's case — or read one back off
     * it through the preview link.
     */
    const { dispute } = await fixture();
    sessionUserId = "a-different-person";

    const result = await postFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "receipt.pdf",
      contentType: PDF,
      size: 2_000,
      as: "seller",
    });

    expect(result.status).toBe(403);
    expect(uploads).toHaveLength(0);
    expect(await evidenceFilesFor(dispute.id)).toHaveLength(0);
  });

  it("ignores an as=staff claim — this origin has no staff door", async () => {
    /*
     * The old contract let `as` choose which check ran, and the staff branch
     * sat behind this app's capability-less `requireStaff` — a door around
     * the `money:move` gate /hq's own route asks. The branch is gone: staff
     * attach evidence through apps/hq, and a stranger claiming staff here is
     * refused exactly like a stranger claiming nothing.
     */
    const { dispute } = await fixture();
    sessionUserId = "a-different-person";

    const result = await postFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "receipt.pdf",
      contentType: PDF,
      size: 2_000,
      as: "staff",
    });
    expect(result.status).toBe(403);
    expect(uploads).toHaveLength(0);
  });

  it("refuses a file over the whole allowance with 413, before reading it", async () => {
    const { shop, dispute } = await fixture();
    sessionUserId = shop.userId;
    const result = await postFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "huge.pdf",
      contentType: PDF,
      size: 5_000_000,
      as: "seller",
    });

    expect(result.status).toBe(413);
    expect(result.body.error).toContain("4.5 MB");
    expect(uploads).toHaveLength(0);
  });

  it("refuses a wrong type with 400 and no upload", async () => {
    const { shop, dispute } = await fixture();
    sessionUserId = shop.userId;
    const result = await postFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "notes.txt",
      contentType: "text/plain",
      size: 2_000,
      as: "seller",
    });

    expect(result.status).toBe(400);
    expect(uploads).toHaveLength(0);
  });

  it("404s in effect on a dispute that does not exist", async () => {
    const result = await postFile({
      disputeId: "00000000-0000-0000-0000-000000000000",
      field: "receipt",
      filename: "r.pdf",
      contentType: PDF,
      size: 2_000,
      as: "staff",
    });
    expect(result.status).toBe(403);
    expect(uploads).toHaveLength(0);
  });
});

describe("looking at a document before it is sent", () => {
  /*
   * The preview is the more dangerous of the two endpoints, not the less: a
   * document on a dispute names a buyer, their address and what they bought. It
   * therefore runs the *same* authorisation as the upload — which is the reason
   * that check lives in `dispute-access.ts` rather than inside either route.
   */
  async function preview(disputeId: string, field: string, as: "staff" | "seller") {
    const url = `http://localhost/api/disputes/${disputeId}/evidence/${field}?as=${as}`;
    const response = await previewRoute(new Request(url), {
      params: Promise.resolve({ id: disputeId, field }),
    });
    return response;
  }

  it("redirects the owning seller to a short-lived Stripe link", async () => {
    /* Staff preview lives on /hq's own route now, behind money:move. */
    const { shop, dispute } = await fixture();
    sessionUserId = shop.userId;
    await attachEvidenceFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "r.pdf",
      contentType: PDF,
      bytes: bytes(1_000),
      uploadedBy: "seller@example.com",
    });

    const response = await preview(dispute.id, "receipt", "seller");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("files.stripe.com");
  });

  it("refuses a seller looking at somebody else's document", async () => {
    const { dispute } = await fixture();
    await attachEvidenceFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "r.pdf",
      contentType: PDF,
      bytes: bytes(1_000),
      uploadedBy: "staff@sailo.test",
    });
    sessionUserId = "a-different-person";

    const response = await preview(dispute.id, "receipt", "seller");
    expect(response.status).toBe(403);
  });

  it("404s for a field with nothing on it", async () => {
    const { shop, dispute } = await fixture();
    sessionUserId = shop.userId;
    const response = await preview(dispute.id, "receipt", "seller");
    expect(response.status).toBe(404);
  });
});

describe("one document per field", () => {
  it("replaces rather than duplicating", async () => {
    /*
     * Postgres decides this, not the application. Stripe's evidence object has
     * one slot per field, so two rows would submit one and silently drop the
     * other with nothing recording which.
     */
    const { dispute } = await fixture();

    for (const name of ["first.pdf", "second.pdf"]) {
      await attachEvidenceFile({
        disputeId: dispute.id,
        field: "shipping_documentation",
        filename: name,
        contentType: PDF,
        bytes: bytes(1_000),
        uploadedBy: "staff@sailo.test",
      });
    }

    const rows = await evidenceFilesFor(dispute.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.filename).toBe("second.pdf");
  });

  it("names the document it replaced, so the surface can say so", async () => {
    const { dispute } = await fixture();
    await attachEvidenceFile({
      disputeId: dispute.id,
      field: "customer_communication",
      filename: "chat-1.png",
      contentType: "image/png",
      bytes: bytes(1_000),
      uploadedBy: "seller@example.com",
    });
    const second = await attachEvidenceFile({
      disputeId: dispute.id,
      field: "customer_communication",
      filename: "chat-2.png",
      contentType: "image/png",
      bytes: bytes(1_000),
      uploadedBy: "seller@example.com",
    });

    expect(second.ok).toBe(true);
    if (second.ok) expect(second.replaced).toBe("chat-1.png");
  });
});

describe("the 4.5 MB ceiling", () => {
  it("refuses the file before it reaches Stripe", async () => {
    /*
     * Order matters more than the refusal. Stripe's Files API has no delete, so
     * a document uploaded and *then* rejected is a permanent orphan on the
     * seller's own account — one for every mistake they make.
     */
    const { dispute } = await fixture();

    await attachEvidenceFile({
      disputeId: dispute.id,
      field: "shipping_documentation",
      filename: "big.pdf",
      contentType: PDF,
      bytes: bytes(4_000_000),
      uploadedBy: "staff@sailo.test",
    });
    expect(uploads).toHaveLength(1);

    const second = await attachEvidenceFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "receipt.pdf",
      contentType: PDF,
      bytes: bytes(600_000),
      uploadedBy: "staff@sailo.test",
    });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("4.5 MB");
    /* Still one: the refused file never left. */
    expect(uploads).toHaveLength(1);
    expect(await evidenceFilesFor(dispute.id)).toHaveLength(1);
  });

  it("lets a smaller file replace a larger one on the same field", async () => {
    /*
     * The correction the ceiling is asking for must not be the thing it refuses.
     * A seller compressing a 4 MB scan to 1 MB is making the set smaller.
     */
    const { dispute } = await fixture();
    await attachEvidenceFile({
      disputeId: dispute.id,
      field: "shipping_documentation",
      filename: "huge.pdf",
      contentType: PDF,
      bytes: bytes(4_400_000),
      uploadedBy: "staff@sailo.test",
    });

    const smaller = await attachEvidenceFile({
      disputeId: dispute.id,
      field: "shipping_documentation",
      filename: "compressed.pdf",
      contentType: PDF,
      bytes: bytes(1_000_000),
      uploadedBy: "staff@sailo.test",
    });
    expect(smaller.ok).toBe(true);
  });

  it("refuses a type Stripe does not take, before uploading it", async () => {
    const { dispute } = await fixture();
    const result = await attachEvidenceFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "scan.heic",
      contentType: "image/heic",
      bytes: bytes(1_000),
      uploadedBy: "staff@sailo.test",
    });
    expect(result.ok).toBe(false);
    expect(uploads).toHaveLength(0);
  });
});

describe("once the answer has gone", () => {
  it("refuses further documents", async () => {
    /*
     * Stripe reads one submitted response. A seller allowed to attach afterwards
     * is being told they have supplied what was missing on a case that is
     * already decided, which is the most expensive lie this surface could tell.
     */
    const { dispute } = await fixture();
    await db
      .update(disputes)
      .set({ evidenceSubmittedAt: new Date() })
      .where(eq(disputes.id, dispute.id));

    const result = await attachEvidenceFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "late.pdf",
      contentType: PDF,
      bytes: bytes(1_000),
      uploadedBy: "seller@example.com",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already been sent");
    expect(uploads).toHaveLength(0);
  });

  it("refuses to withdraw one", async () => {
    const { dispute } = await fixture();
    await attachEvidenceFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "r.pdf",
      contentType: PDF,
      bytes: bytes(1_000),
      uploadedBy: "staff@sailo.test",
    });
    await db
      .update(disputes)
      .set({ evidenceSubmittedAt: new Date() })
      .where(eq(disputes.id, dispute.id));

    const result = await detachEvidenceFile({
      disputeId: dispute.id,
      field: "receipt",
    });
    expect(result.ok).toBe(false);
    expect(await evidenceFilesFor(dispute.id)).toHaveLength(1);
  });
});

describe("removing a document", () => {
  it("takes it out of the submission", async () => {
    const { dispute } = await fixture();
    await attachEvidenceFile({
      disputeId: dispute.id,
      field: "shipping_documentation",
      filename: "delivery.pdf",
      contentType: PDF,
      bytes: bytes(1_000),
      uploadedBy: "staff@sailo.test",
    });
    expect(Object.keys(await evidenceFileIdsFor(dispute.id))).toContain(
      "shipping_documentation",
    );

    const removed = await detachEvidenceFile({
      disputeId: dispute.id,
      field: "shipping_documentation",
    });
    expect(removed.ok).toBe(true);
    expect(await evidenceFileIdsFor(dispute.id)).toEqual({});
  });
});

describe("a failed upload leaves nothing behind", () => {
  it("records no row when Stripe refuses", async () => {
    /*
     * A row written before the upload succeeded would claim a document is
     * attached that does not exist, and the submission would carry a file id
     * Stripe has never heard of — failing the whole update and losing the fields
     * that were right.
     */
    const { dispute } = await fixture();
    uploadSucceeds = false;

    const result = await attachEvidenceFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "r.pdf",
      contentType: PDF,
      bytes: bytes(1_000),
      uploadedBy: "staff@sailo.test",
    });

    expect(result.ok).toBe(false);
    expect(await evidenceFilesFor(dispute.id)).toHaveLength(0);
  });
});

describe("what a digital sale is asked for", () => {
  it("does not demand a proof of delivery for a download", async () => {
    /*
     * Same reason code, different case. "It never arrived" on a download is
     * answered with an access log, and a panel asking the seller for a carrier's
     * receipt is asking for something that cannot exist.
     */
    const { shop } = await fixture({ productKind: "digital" });
    const seller = await getSellerDisputes(shop.id);
    const wanted = seller[0]?.uploads.filter((u) => u.required).map((u) => u.field) ?? [];
    expect(wanted).not.toContain("shipping_documentation");
  });
});

describe("the rows are cleaned up with the dispute", () => {
  it("cascades", async () => {
    /*
     * `dispute_evidence_files` hangs off `disputes` and nothing else deletes it.
     * Without the cascade a purged fixture database keeps the rows and the
     * unique index starts refusing inserts for disputes that no longer exist.
     */
    const { dispute } = await fixture();
    await attachEvidenceFile({
      disputeId: dispute.id,
      field: "receipt",
      filename: "r.pdf",
      contentType: PDF,
      bytes: bytes(1_000),
      uploadedBy: "staff@sailo.test",
    });

    await db.delete(disputes).where(eq(disputes.id, dispute.id));
    const left = await db
      .select()
      .from(disputeEvidenceFiles)
      .where(eq(disputeEvidenceFiles.disputeId, dispute.id));
    expect(left).toHaveLength(0);
  });
});
