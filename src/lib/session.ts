import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { getDb } from "@/db";
import { shops } from "@/db/schema";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  return session.user;
}

/** Everything behind /admin needs both a user and the shop they own. */
export async function requireShop() {
  const user = await requireUser();
  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.userId, user.id),
  });
  if (!shop) redirect("/onboarding");
  return { user, shop };
}
