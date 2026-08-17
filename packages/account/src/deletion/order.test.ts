import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The order of operations, and the rows deletion is not allowed to destroy.
 *
 * WHY THIS IS A SOURCE SCAN
 *
 * The sequence is not testable without Stripe, a blob store and a database, and what is
 * being protected is a property of the *order* rather than of any return value: the
 * email goes before the address is overwritten, the blob URLs are collected before the
 * rows naming them are deleted, sessions are revoked last. Each of those, moved, is a
 * silent and unrecoverable loss that no assertion on an output would catch.
 *
 * WHY IT MOVED HERE
 *
 * It was `apps/web/src/lib/account-deletion.test.ts`, reaching across the repo with
 * `readFileSync("../../packages/account/src/deletion.ts")`. That path broke the moment
 * the module became a folder — which is the failure mode this repo has already paid for
 * elsewhere: a scan whose subject moves either breaks loudly or, worse, keeps passing
 * while covering nothing.
 *
 * Now it reads its own package's files, resolved from this module's own URL rather than
 * from a working directory, so a rename fails here rather than somewhere downstream.
 */

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

const sequence = read("./index.ts");
const content = read("./content.ts");

/** Where a step happens, with a failure that says what to do about it. */
function positionOf(label: string, needle: string): number {
  const at = sequence.indexOf(needle);
  if (at === -1) {
    throw new Error(
      `deletion/index.ts: this test pins the order of operations and the anchor for ` +
        `"${label}" (${needle}) no longer matches. Re-anchor it rather than deleting ` +
        `it — the ordering is the thing under test.`,
    );
  }
  return at;
}

describe("the order of operations", () => {
  const refusal = positionOf("obligation refusal", "if (obligations.blocked)");
  const stripe = positionOf("stripe cancellation", "await cancelPlatformSubscription(");
  // Injected rather than imported since the move — see `DeletionEffects`.
  const email = positionOf("farewell email", "await effects.notifyDeleted(");
  const collect = positionOf("blob snapshot", "await collectBlobUrls(");
  const tombstone = positionOf("user tombstone", "email: tombstoneEmail(owner.id)");
  const hardDelete = positionOf("hard delete", "await hardDeleteShopContent(");
  const deleteBlobs = positionOf("blob deletion", "await deleteBlobs(blobs.images)");
  const revoke = positionOf(
    "session revocation",
    "db.delete(sessionTable).where(eq(sessionTable.userId, userId))",
  );

  it("refuses before it touches anything", () => {
    // A refusal arriving after the Stripe subscription is cancelled has already done
    // damage to an account it then declines to delete.
    expect(refusal).toBeLessThan(stripe);
  });

  it("emails the seller before overwriting the address", () => {
    /*
     * The single most unrecoverable ordering in the file. After the tombstone write
     * there is no address left to reach them at, so a deletion nobody asked for could
     * never be reported. The mail has to go first.
     */
    expect(email).toBeLessThan(tombstone);
  });

  it("collects blob URLs before deleting the rows that name them", () => {
    // The rows are the only index of which objects belong to this shop. Once they are
    // gone the blobs are unreachable and billed for ever.
    expect(collect).toBeLessThan(hardDelete);
  });

  it("deletes the objects only after the rows are gone", () => {
    expect(hardDelete).toBeLessThan(deleteBlobs);
  });

  it("revokes sessions last, because that is the actor's own", () => {
    // Every step above needs the caller signed in; this is the one that signs them out,
    // so anything after it would run for a session that just died.
    expect(deleteBlobs).toBeLessThan(revoke);
  });
});

describe("what deletion is not allowed to destroy", () => {
  /*
   * Both files, because the split moved the deletes into `./content` while the sequence
   * stayed in `./index`. Scanning only one of them would leave the other free to add a
   * `db.delete(shops)` that nothing notices.
   */
  const everything = `${sequence}\n${content}`;

  it("never deletes the shop, the orders or the invoices", () => {
    /*
     * The whole design rests on these rows surviving: `invoices.shopId` and
     * `orders.shopId` both cascade from `shops`, so one `db.delete(shops)` would take a
     * tax-relevant sequence with it and no test that only reads return values would
     * notice.
     */
    expect(everything).not.toContain("db.delete(shops)");
    expect(everything).not.toContain("db.delete(orders)");
    expect(everything).not.toContain("db.delete(invoices)");
    expect(everything).not.toContain("db.delete(userTable)");
  });

  it("keeps the buyers, who did not ask to be deleted", () => {
    expect(everything).not.toContain("db.delete(clients)");
  });

  it("removes the seller's own banking details", () => {
    // `payment_methods` holds account numbers, IBANs and SWIFT codes. Not in the spec's
    // list, and deleted anyway: keeping a departed seller's banking credentials for ever
    // is not a defensible thing to do with them.
    expect(content).toContain("db.delete(paymentMethods)");
  });

  it("removes the second factor, which does not cascade here", () => {
    // `two_factor` cascades from `user`, and the user row deliberately survives — so
    // without this the enrolled secret outlives the account.
    expect(content).toContain('DELETE FROM "two_factor"');
  });

  /*
   * The scan is only as good as its subjects existing. If a future split moves the
   * deletes into a third file, these strings stop matching and every assertion above
   * passes by describing an empty set.
   */
  it("is reading files that actually contain the deletion", () => {
    expect(sequence).toContain("export async function deleteAccountFor");
    expect(content).toContain("export async function hardDeleteShopContent");
  });
});
