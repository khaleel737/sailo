import { initTRPC, TRPCError } from "@trpc/server";

/**
 * What a request carries once apps/web has worked out who is asking.
 *
 * The web route reads the bearer token through better-auth, finds the seller's
 * shop and drops its id here. The package itself never imports better-auth or
 * `next/headers`, so it stays runnable from a plain test and buildable off a
 * phone — the auth lives at the edge, the data access lives here.
 */
export type Context = {
  shopId: string | null;
  /**
   * The signed-in account, which is **not** the same question as `shopId`.
   *
   * Every other procedure in this package scopes to a shop, so for a long time
   * the shop id was the only thing the context needed to carry. Sign-up broke
   * that: a seller who has just created an account has a session and no shop,
   * and `shop.create` is the procedure that gives them one. Resolving them by
   * shop would have been resolving them by the thing they are asking for.
   *
   * Null for an unauthenticated caller, exactly like `shopId`. A non-null
   * `shopId` always implies a non-null `userId` — the shop was found *through*
   * the session — but not the reverse.
   */
  userId: string | null;
};

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Everything a seller reads is scoped to their own shop. This refuses the call
 * when no shop resolved, and — the point — narrows `ctx.shopId` to a string for
 * every procedure built on it, so a query that forgets the `where` cannot even
 * be written.
 */
export const shopProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.shopId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to your shop." });
  }
  return next({ ctx: { shopId: ctx.shopId, userId: ctx.userId } });
});

/**
 * Signed in, with or without a shop.
 *
 * The narrow door, and deliberately narrow: it exists for the handful of calls
 * a seller makes *before* they have a shop — checking whether a handle is free
 * and then claiming it. Everything else stays on `shopProcedure`, because
 * "signed in" is not an authorisation to read anything, and a procedure built
 * on this one has to name the row it is allowed to touch itself.
 *
 * Adding a read here is almost always the wrong instinct. If it answers a
 * question about a shop, it belongs on `shopProcedure`.
 */
export const userProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first." });
  }
  return next({ ctx: { userId: ctx.userId, shopId: ctx.shopId } });
});
