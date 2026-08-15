import { router } from "./trpc";
import { accountRouter } from "./routers/account";
import { analyticsRouter } from "./routers/analytics";
import { categoriesRouter } from "./routers/categories";
import { couponsRouter } from "./routers/coupons";
import { eventsRouter } from "./routers/events";
import { reviewsRouter } from "./routers/reviews";
import { ordersRouter } from "./routers/orders";
import { paymentsRouter } from "./routers/payments";
import { productsRouter } from "./routers/products";
import { pushRouter } from "./routers/push";
import { shopRouter } from "./routers/shop";
import { ticketsRouter } from "./routers/tickets";
import { uploadsRouter } from "./routers/uploads";

/**
 * The surface the mobile app opens on, assembled from `routers/`.
 *
 * **This file is a composition root and nothing else.** No procedure, no zod
 * schema, no query is written here — every one of them lives in the domain file
 * it belongs to. That is a deliberate constraint rather than tidiness: several
 * agents are adding procedures to this package at the same time, and a single
 * module holding all of them is a merge conflict on every push. Split, each
 * touches one file nobody else has open, and this list stops changing.
 *
 * Six of the ten namespaces below are empty seams, committed ahead of the work
 * that fills them so that work never has to edit this file either. `routers/`
 * says which is which and who owns each.
 *
 * The rule every one of them holds: reads and writes are scoped by `ctx.shopId`
 * in the WHERE, never by an id the client sends. `shopProcedure` in `./trpc`
 * refuses a request with no shop, and `found()` in `./shared` gives "not yours"
 * and "doesn't exist" the same answer so neither can be used to probe the other.
 */
export const appRouter = router({
  shop: shopRouter,
  products: productsRouter,
  categories: categoriesRouter,
  orders: ordersRouter,
  analytics: analyticsRouter,
  payments: paymentsRouter,
  coupons: couponsRouter,
  reviews: reviewsRouter,
  events: eventsRouter,
  tickets: ticketsRouter,
  account: accountRouter,
  uploads: uploadsRouter,
  push: pushRouter,
});

export type AppRouter = typeof appRouter;
