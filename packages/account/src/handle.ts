import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { suggestHandles } from "@sailo/core/handle";

/**
 * Whether a shop handle is free, and what to offer instead.
 *
 * WHY THIS IS SHARED AND THE VERDICT IS NOT
 *
 * `isHandleTaken` was written twice, identically: once in
 * `packages/api/src/routers/shop.ts` for the phone's onboarding and once in
 * `apps/web/src/lib/actions/shop.ts` for the settings form. It is the read that
 * decides whether a seller may claim a name, and two copies of it is two answers
 * to that — the kind that only disagree once one of them learns something, such
 * as that a soft-deleted shop still holds its handle.
 *
 * What is deliberately *not* shared is the shape of the answer. tRPC returns a
 * verdict object with suggestions, the web action returns an `ActionState` with a
 * message, and the REST API would return neither. Those are transport
 * decisions; the read is not.
 *
 * The *rules* — what a handle may look like, which are reserved, what to say
 * about each problem — are `@sailo/core/handle`, which has no database in it.
 * This module is the one place those rules meet the `shops` table.
 */

/**
 * Is this handle already somebody's?
 *
 * `exceptShopId` is for a seller editing their own shop: their current handle is
 * taken *by them*, and refusing it would mean they could never save the settings
 * form without also renaming. Omitting it is the sign-up case.
 *
 * Availability is a read, and a read is a moment. Two people can pass this check
 * with the same handle and race to the insert — which is why the unique index on
 * `shops.handle` is the actual guarantee and every caller must still handle a
 * `23505`. This makes the common case a message instead of an error page; it does
 * not make the write safe on its own.
 */
export async function isHandleTaken(
  handle: string,
  exceptShopId?: string,
): Promise<boolean> {
  const existing = await getDb().query.shops.findFirst({
    where: exceptShopId
      ? and(eq(shops.handle, handle), ne(shops.id, exceptShopId))
      : eq(shops.handle, handle),
    columns: { id: true },
  });
  return Boolean(existing);
}

/**
 * Three alternatives that are themselves free.
 *
 * A suggestion the seller taps and is then refused is worse than offering none,
 * so each candidate is checked rather than merely generated. `suggestHandles`
 * produces the candidates and knows nothing about what exists.
 */
export async function freeHandleSuggestions(handle: string): Promise<string[]> {
  const candidates = suggestHandles(handle);
  const checked = await Promise.all(
    candidates.map(async (candidate) => ((await isHandleTaken(candidate)) ? null : candidate)),
  );
  /* Three, which is what both former copies offered — a longer list reads as a
     rejection with homework rather than a suggestion. */
  return checked.filter((c): c is string => c !== null).slice(0, 3);
}
