import { describe, expect, it } from "vitest";
import type { EvidenceFileField } from "./reasons";
import {
  EVIDENCE_FILE_BUDGET_BYTES,
  EVIDENCE_FILE_GUIDE,
  EVIDENCE_FILE_TYPES,
  acceptEvidenceFile,
  budgetPressure,
  bytesHeld,
  formatBytes,
  type HeldFile,
} from "./files";
import { EVIDENCE_FILE_FIELDS } from "./reasons";

/**
 * The ceiling that decides whether evidence can be sent at all.
 *
 * Every case here is one a seller reaches by doing something reasonable, and the
 * cost of getting it wrong is not a bad error message — it is a submission
 * rejected by Stripe at the deadline, or two of three screenshots silently
 * dropped. The combined budget is the part no per-file check can express, so it
 * is the part most of these are about.
 */

const pdf = (
  bytes: number,
  field: EvidenceFileField = "shipping_documentation",
) => ({ field, bytes, contentType: "application/pdf" });

const held = (field: HeldFile["field"], bytes: number, filename = "a.pdf"): HeldFile => ({
  field,
  bytes,
  filename,
});

describe("what Stripe will take", () => {
  it("accepts exactly PDF, JPEG and PNG", () => {
    expect([...EVIDENCE_FILE_TYPES]).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/png",
    ]);
  });

  it.each(["image/heic", "image/gif", "text/plain", "application/msword", "image/jpg"])(
    "refuses %s before it can fail the whole submission",
    (contentType) => {
      const verdict = acceptEvidenceFile(
        { field: "receipt", bytes: 1_000, contentType },
        [],
      );
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toBe("type");
    },
  );

  it("refuses an empty file", () => {
    /*
     * A zero-byte upload is what a failed drag-and-drop produces. Stripe accepts
     * it, stores it, and the issuer receives a blank page where the proof of
     * delivery was meant to be — which loses the case more quietly than sending
     * nothing would.
     */
    const verdict = acceptEvidenceFile(
      { field: "receipt", bytes: 0, contentType: "application/pdf" },
      [],
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("empty");
  });
});

describe("the 4.5 MB ceiling is combined, not per file", () => {
  it("takes a file that fits on its own and with the others", () => {
    const verdict = acceptEvidenceFile(pdf(1_000_000), [
      held("receipt", 500_000),
    ]);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.remainingBytes).toBe(3_000_000);
  });

  it("refuses a file that fits on its own but not beside what is held", () => {
    /*
     * The defect this whole module exists for. Every file here is legal alone —
     * 4 MB and 600 KB are both well under any per-file limit anyone would write
     * — and the set is not. A per-file check passes both and the submission
     * fails at Stripe, hours before the deadline.
     */
    const verdict = acceptEvidenceFile(pdf(600_000, "receipt"), [
      held("shipping_documentation", 4_000_000),
    ]);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok && verdict.reason === "budget") {
      expect(verdict.overBy).toBe(100_000);
      expect(verdict.message).toContain("4.5 MB");
    } else {
      expect.unreachable("a set over the ceiling must be refused for budget");
    }
  });

  it("accepts a set landing exactly on the ceiling", () => {
    const verdict = acceptEvidenceFile(pdf(500_000, "receipt"), [
      held("shipping_documentation", 4_000_000),
    ]);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.remainingBytes).toBe(0);
  });

  it("refuses one byte over it", () => {
    const verdict = acceptEvidenceFile(pdf(500_001, "receipt"), [
      held("shipping_documentation", 4_000_000),
    ]);
    expect(verdict.ok).toBe(false);
  });
});

describe("replacing a document does not pay for it twice", () => {
  it("frees the bytes of the file it replaces", () => {
    /*
     * A seller replacing a 4 MB scan with a 1 MB compressed one is making the
     * set *smaller*, and must not be refused for it. Counting the outgoing file
     * against the budget would refuse exactly the correction the ceiling is
     * asking them to make.
     */
    const verdict = acceptEvidenceFile(pdf(1_000_000), [
      held("shipping_documentation", 4_000_000, "huge-scan.pdf"),
      held("receipt", 400_000),
    ]);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.replaces?.filename).toBe("huge-scan.pdf");
      expect(verdict.remainingBytes).toBe(4_500_000 - 1_400_000);
    }
  });

  it("names the file being replaced so the surface can say so first", () => {
    /*
     * Stripe keeps one file per evidence field. A seller uploading a third
     * screenshot to `customer_communication` is not adding to a conversation,
     * they are discarding the first two — and the only moment that can be said
     * is before it happens.
     */
    const verdict = acceptEvidenceFile(
      { field: "customer_communication", bytes: 10_000, contentType: "image/png" },
      [held("customer_communication", 9_000, "chat-1.png")],
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.replaces?.filename).toBe("chat-1.png");
  });

  it("reports no replacement when the field is empty", () => {
    const verdict = acceptEvidenceFile(pdf(10_000), [held("receipt", 9_000)]);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.replaces).toBeNull();
  });
});

describe("the pressure meter", () => {
  it("is quiet on an empty set", () => {
    const pressure = budgetPressure([]);
    expect(pressure.usedBytes).toBe(0);
    expect(pressure.usedPct).toBe(0);
    expect(pressure.tight).toBe(false);
    expect(pressure.remainingBytes).toBe(EVIDENCE_FILE_BUDGET_BYTES);
  });

  it("warns at three quarters, while there is still time to compress", () => {
    /*
     * The useful moment is before the refusal. A seller at 88% with a proof of
     * delivery still to add needs to know now — after the upload fails, the
     * remedy is the same and the deadline is closer.
     */
    expect(budgetPressure([held("receipt", 3_374_999)]).tight).toBe(false);
    expect(budgetPressure([held("receipt", 3_375_000)]).tight).toBe(true);
  });

  it("never reports negative headroom", () => {
    /*
     * A set can exceed the ceiling without this module's help — a limit lowered
     * by a network, or rows written before it was enforced. The meter has to
     * degrade to "none left" rather than to a negative number rendered as bytes.
     */
    const pressure = budgetPressure([held("receipt", 9_000_000)]);
    expect(pressure.remainingBytes).toBe(0);
    expect(pressure.usedPct).toBe(200);
  });

  it("sums the set", () => {
    expect(bytesHeld([held("receipt", 10), held("customer_signature", 32)])).toBe(42);
  });
});

describe("the guide the seller is actually shown", () => {
  it("covers every file field Stripe accepts", () => {
    /*
     * A field with no guide entry renders as its API name — `service_documentation`
     * — and a seller shown that uploads the wrong document or none. The map is
     * exhaustive by test rather than by hope, because adding a field to
     * `EVIDENCE_FILE_FIELDS` and forgetting the copy is the obvious way to break it.
     */
    for (const field of EVIDENCE_FILE_FIELDS) {
      expect(EVIDENCE_FILE_GUIDE[field]?.label, field).toBeTruthy();
      expect(EVIDENCE_FILE_GUIDE[field]?.wants, field).toBeTruthy();
    }
  });

  it("tells the proof-of-delivery case what an issuer checks for", () => {
    /*
     * Stripe's guidance is specific and counter-intuitive: a tracking number is
     * not enough, the document has to carry the *full* address rather than the
     * city and postcode an AVS check produces.
     */
    expect(EVIDENCE_FILE_GUIDE.shipping_documentation.wants).toContain("full address");
  });

  it("warns that messages are one file, not many", () => {
    expect(EVIDENCE_FILE_GUIDE.customer_communication.wants).toContain("Combine");
  });
});

describe("sizes as a human reads them", () => {
  it.each([
    [512, "512 B"],
    [1_000, "1 KB"],
    [1_400_000, "1.4 MB"],
    [4_500_000, "4.5 MB"],
  ])("renders %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("uses decimal megabytes, because that is how the limit is stated", () => {
    /*
     * 4.5 MB in binary megabytes is 4,718,592 bytes, and a meter that read
     * "4.3 MB" beside a limit stated as 4.5 would look like it had headroom it
     * does not have.
     */
    expect(formatBytes(EVIDENCE_FILE_BUDGET_BYTES)).toBe("4.5 MB");
  });
});
