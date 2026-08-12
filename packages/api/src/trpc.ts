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
  return next({ ctx: { shopId: ctx.shopId } });
});
