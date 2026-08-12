import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq } from "drizzle-orm";
import { appRouter, type Context } from "@sailo/api";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { auth } from "@/lib/auth";

/**
 * The mobile app's data endpoint.
 *
 * This is the one place better-auth meets @sailo/api: it reads the bearer token
 * the app sent (the `bearer()` plugin looks in `Authorization`), resolves the
 * seller's shop, and hands @sailo/api nothing but a `shopId`. Every procedure
 * scopes to that id, so a token that resolves to no shop can read nothing.
 */
async function createContext(req: Request): Promise<Context> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) return { shopId: null };
  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.userId, session.user.id),
  });
  return { shopId: shop?.id ?? null };
}

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext(req),
  });
}

export { handler as GET, handler as POST };
