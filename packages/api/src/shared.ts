import { z } from "zod";
import { TRPCError } from "@trpc/server";

/**
 * The pieces every router file in `routers/` needs, kept in one place so there
 * is one copy of each rather than ten.
 *
 * This file exists because the router was split. When it was a single 256-line
 * module these were four consts at the top of it and that was fine; across ten
 * files, a second hand-rolled `byId` that spelled the uuid check differently —
 * or a second `found()` that answered `FORBIDDEN` — would be a tenancy hole
 * introduced by a copy-paste. Import them; do not restate them.
 */

/**
 * How many rows a list procedure will return.
 *
 * The ceiling is the honest part: a caller asking for 1,000 is refused rather
 * than quietly handed 100, because a silently clamped page reads to the client
 * as "that is all there is".
 */
export const listInput = z
  .object({ limit: z.number().int().min(1).max(100).default(50) })
  .optional();

/**
 * The id of a row the caller claims is theirs — checked against `ctx.shopId`
 * in the WHERE, never taken as proof of anything on its own.
 *
 * `uuid()` rather than a bare string because both columns are `uuid`: handing
 * Postgres `"' or 1=1"` for one of these is not a leak — drizzle parameterises
 * it — but it *is* an `invalid input syntax for type uuid`, which reaches the
 * seller as a 500 from a screen that should have said "not found".
 */
export const byId = z.object({ id: z.uuid() });

/**
 * An Expo push token, in either spelling Expo's own SDK accepts.
 *
 * Checked on the way in rather than at send time because this column exists to
 * be POSTed to a third party: anything that gets stored here will one day be
 * put in a request body to Expo, and the cheapest place to refuse a junk value
 * is before it becomes a row. Deliberately loose about the contents of the
 * brackets — the shape is documented, the payload inside is Expo's business.
 */
export const pushToken = z
  .string()
  .regex(/^Expo(nent)?PushToken\[[^\]\s]+\]$/, "Not an Expo push token.");

/**
 * One answer for "that row isn't yours" and "that row doesn't exist".
 *
 * Both are `NOT_FOUND` on purpose. The scoping is done by the WHERE, so a row
 * belonging to another shop simply doesn't match and arrives here as
 * `undefined` — and if the two cases answered differently, a seller could
 * learn which ids exist in someone else's shop by reading the error code.
 */
export function found<T>(row: T | undefined | null, what: string): T {
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `No such ${what}.` });
  return row;
}
