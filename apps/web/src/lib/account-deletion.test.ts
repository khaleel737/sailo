import { describe, expect, it, vi } from "vitest";

/**
 * What this app adds to the deletion.
 *
 * The deletion itself, its ordering and its guards are `@sailo/account/deletion`, tested
 * beside the code — see `deletion/order.test.ts` for the sequence and
 * `deletion/tombstone.test.ts` for the handle. This file used to hold all of that and
 * read the package's source with a relative path, which broke the moment that module
 * became a folder.
 *
 * What is left here is genuinely this app's: two effects the package cannot perform
 * itself, and which are optional — so forgetting one is a silent partial deletion rather
 * than a failure. The package's own header says what each omission costs, and this
 * asserts that apps/web omits neither.
 */

const runDeletion = vi.fn();
const sendAccountDeleted = vi.fn();
const updateShopNow = vi.fn();

vi.mock("@sailo/account/deletion", () => ({ deleteAccountFor: runDeletion }));
vi.mock("@/lib/email", () => ({ sendAccountDeleted }));
vi.mock("@/lib/cache", () => ({ updateShopNow }));

const { deleteAccountFor } = await import("./account-deletion");

describe("the effects this app hands in", () => {
  it("passes both, because each omission loses something the package names", () => {
    runDeletion.mockResolvedValue({ ok: true });

    void deleteAccountFor("user-1");

    const effects = runDeletion.mock.calls[0]?.[1] ?? {};
    // Without `notifyDeleted` a deletion nobody asked for is never reported; without
    // `dropCaches` the released handle keeps resolving to a cached storefront.
    expect(effects.notifyDeleted).toBe(sendAccountDeleted);
    expect(effects.dropCaches).toBe(updateShopNow);
  });

  it("passes the user through unchanged", async () => {
    runDeletion.mockResolvedValue({ ok: true });

    await deleteAccountFor("user-42");

    expect(runDeletion).toHaveBeenCalledWith("user-42", expect.any(Object));
  });

  it("returns the package's verdict rather than reinterpreting it", async () => {
    runDeletion.mockResolvedValue({ ok: false, reason: "obligations", count: 3 });

    expect(await deleteAccountFor("user-1")).toEqual({
      ok: false,
      reason: "obligations",
      count: 3,
    });
  });
});
