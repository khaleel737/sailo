import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tombstoneEmail, tombstoneHandle } from "./account-deletion";
import { HANDLE_MAX, normalizeHandle, validateHandleFormat } from "@sailo/core/handle";

/**
 * Account deletion, in the two ways it can be got wrong.
 *
 * The tombstone is testable directly — it is a pure function, and the handle
 * it produces has to satisfy rules written somewhere else entirely.
 *
 * The order of operations is not testable without Stripe, a blob store and a
 * database, so it is pinned the way `orders.test.ts` pins the order of the
 * checkout's irreversible steps: as source positions. The property being
 * protected is a property of the *sequence* — email before the address is
 * overwritten, blob URLs collected before the rows naming them are deleted,
 * sessions revoked last — and each of those is a silent, unrecoverable data
 * loss if it moves.
 *
 * The sequence moved to `@sailo/account/deletion` when the phone needed to run
 * it too; this test followed it there rather than being rewritten, because it
 * is the record of *why* the order is what it is. It stays in this app because
 * the tombstoned handle has to satisfy `./handle`, which is web's.
 */

const source = readFileSync(
  "../../packages/account/src/deletion.ts",
  "utf8",
);

/** Where a step happens, with a failure that says what to do about it. */
function positionOf(label: string, needle: string): number {
  const at = source.indexOf(needle);
  if (at === -1) {
    throw new Error(
      `@sailo/account/deletion: this test pins the order of operations and ` +
        `the anchor for "${label}" (${needle}) no longer matches. Re-anchor ` +
        `it rather than deleting it — the ordering is the thing under test.`,
    );
  }
  return at;
}

describe("the tombstoned handle is a handle", () => {
  it("fits inside the rules the handle validator enforces", () => {
    /*
     * `deleted-<uuid>` is 44 characters and `HANDLE_MAX` is 32, so the obvious
     * spelling is rejected — and the obvious fix, truncating the uuid, lands
     * on a trailing hyphen about a quarter of the time, which the validator
     * also rejects. Both were live bugs waiting in the naive version.
     */
    const handle = tombstoneHandle("550e8400-e29b-41d4-a716-446655440000");

    expect(handle.length).toBeLessThanOrEqual(HANDLE_MAX);
    expect(validateHandleFormat(handle)).toBeNull();
    // Normalising it must not change it, or the handle stored and the handle
    // a re-registration checks against are different strings.
    expect(normalizeHandle(handle)).toBe(handle);
  });

  it("never ends in a dash, whatever the uuid", () => {
    for (let i = 0; i < 16; i += 1) {
      const handle = tombstoneHandle(crypto.randomUUID());
      expect(handle).not.toMatch(/[-_]$/);
      expect(validateHandleFormat(handle)).toBeNull();
    }
  });

  it("is different for every shop", () => {
    const a = tombstoneHandle(crypto.randomUUID());
    const b = tombstoneHandle(crypto.randomUUID());
    expect(a).not.toBe(b);
  });
});

describe("the tombstoned email cannot receive mail", () => {
  it("uses a reserved domain rather than a real one", () => {
    // `.invalid` is reserved by RFC 2606 and resolves nowhere, so a stray send
    // to a tombstone bounces instead of reaching whoever owns the typo domain.
    expect(tombstoneEmail("abc123")).toBe("deleted-abc123@sailo.invalid");
  });
});

describe("the order of operations", () => {
  const refusal = positionOf("obligation refusal", "if (obligations.blocked)");
  const stripe = positionOf(
    "stripe cancellation",
    "await cancelPlatformSubscription(",
  );
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
    // A refusal that arrives after the Stripe subscription is cancelled has
    // already done damage to an account it then declines to delete.
    expect(refusal).toBeLessThan(stripe);
  });

  it("emails the seller before overwriting the address", () => {
    /*
     * The single most unrecoverable ordering in the file. After the tombstone
     * write there is no address left to reach them at, so a deletion nobody
     * asked for could never be reported. The mail has to go first.
     */
    expect(email).toBeLessThan(tombstone);
  });

  it("collects blob URLs before deleting the rows that name them", () => {
    // The rows are the only index of which objects belong to this shop. Once
    // they are gone the blobs are unreachable and billed forever.
    expect(collect).toBeLessThan(hardDelete);
  });

  it("deletes the objects only after the rows are gone", () => {
    expect(hardDelete).toBeLessThan(deleteBlobs);
  });

  it("revokes sessions last, because that is the actor's own", () => {
    // Every step above needs the caller signed in; this is the one that signs
    // them out, so anything after it would run for a session that just died.
    expect(deleteBlobs).toBeLessThan(revoke);
  });
});

describe("what deletion is not allowed to destroy", () => {
  it("never deletes the shop, the orders or the invoices", () => {
    /*
     * The whole design rests on these rows surviving: `invoices.shopId` and
     * `orders.shopId` both cascade from `shops`, so one `db.delete(shops)`
     * would take a tax-relevant sequence with it and no test that only reads
     * return values would notice.
     */
    expect(source).not.toContain("db.delete(shops)");
    expect(source).not.toContain("db.delete(orders)");
    expect(source).not.toContain("db.delete(invoices)");
    expect(source).not.toContain("db.delete(userTable)");
  });

  it("keeps the buyers, who did not ask to be deleted", () => {
    expect(source).not.toContain("db.delete(clients)");
  });

  it("removes the seller's own banking details", () => {
    // `payment_methods` holds account numbers, IBANs and SWIFT codes.
    expect(source).toContain("db.delete(paymentMethods)");
  });

  it("removes the second factor, which does not cascade here", () => {
    // `two_factor` cascades from `user`, and the user row deliberately
    // survives — so without this the secret outlives the account.
    expect(source).toContain('DELETE FROM "two_factor"');
  });
});
