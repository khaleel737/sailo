import { eq } from "drizzle-orm";
import type { Context } from "@sailo/api";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { getAuth } from "@/lib/auth";

/**
 * What apps/web worked out about the caller, minus everything that isn't the
 * shop id.
 *
 * `auth.api.getSession` reads whichever of the two carriers the client used —
 * `Authorization: Bearer <token>` via the bearer plugin, or the `Cookie`
 * header the Expo client keeps in the device keychain — and either resolves to
 * a session row or does not.
 *
 * A `shopId` of null is the only thing an unauthenticated caller can get, and
 * every procedure in `@sailo/api` scopes to that id, so a token that resolves
 * to no shop can read nothing. That makes this the app's authorisation
 * boundary in its entirety, which is why it sits in its own module rather than
 * inside the route: a Next route file exports HTTP verbs, and a boundary worth
 * this much deserves to be callable from a test without one.
 */
export async function createContext(req: Request): Promise<Context> {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.user) return { shopId: null, userId: null };
  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.userId, session.user.id),
  });
  /*
   * A signed-in seller with no shop row is not an error, and this is the one
   * place that has to say so. It is the state between creating an account and
   * claiming a handle, and `shop.create` is the procedure that ends it — so
   * resolving the caller only by their shop would have made the sign-up flow
   * unreachable by the very calls that complete it.
   */
  return { shopId: shop?.id ?? null, userId: session.user.id };
}
