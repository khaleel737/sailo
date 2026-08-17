import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { encodeCursor } from "@sailo/core/paging";
import { cursorFrom } from "./shared";

/**
 * Both transports answer a bad cursor the same way.
 *
 * This is the assertion the duplicate hid. `encodeCursor`/`decodeCursor` existed
 * twice — once here for the REST API, once in `@sailo/commerce/pagination` for
 * the tRPC routers — with identical encoders and different decoders. The REST one
 * checked that the id was uuid-shaped, because `olderThan` interpolates it into
 * `lt(column, id)` against a `uuid` column and Postgres raises on a malformed
 * one. The tRPC copy did not, and `orders.list` and `products.list` used the copy.
 *
 * So the same input was a clean 400 on `GET /api/v1/orders` and a 500 on the
 * phone. Nothing failed: both files had tests, and both passed, because each
 * tested its own decoder.
 *
 * There is one decoder now. What is pinned here is the *router's* half of the
 * contract — that a malformed cursor is refused rather than quietly answered
 * with the first page, which is what the loose decoder made it do.
 */

const ID = "6f1d2b7e-0000-4000-8000-000000000001";

describe("cursorFrom", () => {
  it("reads a cursor we issued", () => {
    const at = new Date("2026-03-04T05:06:07.008Z");
    expect(cursorFrom(encodeCursor({ createdAt: at, id: ID }))).toEqual({
      createdAt: at,
      id: ID,
    });
  });

  it.each([null, undefined, ""])("treats %s as the first page", (raw) => {
    expect(cursorFrom(raw)).toBeNull();
  });

  /*
   * The id that used to reach Postgres. A router that answered this with page one
   * would look correct in every test that did not check the status code.
   */
  it("refuses a cursor whose id is not a uuid, rather than starting at the top", () => {
    const raw = Buffer.from(`2026-03-04T05:06:07.008Z|not-a-uuid`, "utf8").toString(
      "base64url",
    );

    expect(() => cursorFrom(raw)).toThrow(TRPCError);
    try {
      cursorFrom(raw);
    } catch (error) {
      expect((error as TRPCError).code).toBe("BAD_REQUEST");
    }
  });

  it("refuses bytes that decode to nothing usable", () => {
    expect(() => cursorFrom("!!!not base64!!!")).toThrow(TRPCError);
  });
});
