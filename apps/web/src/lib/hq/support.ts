import "server-only";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops, supportTickets } from "@sailo/db/schema";
import { requireStaff } from "@/lib/session";
import { HQ_PAGE_SIZE, like, num, paginate } from "./pagination";

/** The support queue: every ticket sellers have filed, open ones first. */

export type SupportFilters = {
  q?: string;
  status?: string;
  page?: number;
};

export async function getSupportTickets(filters: SupportFilters = {}) {
  await requireStaff();
  const db = getDb();

  const clauses: (SQL | undefined)[] = [];
  if (filters.q?.trim()) {
    const pattern = like(filters.q);
    clauses.push(
      or(
        ilike(supportTickets.subject, pattern),
        ilike(supportTickets.email, pattern),
        ilike(shops.name, pattern),
        ilike(shops.handle, pattern),
      ),
    );
  }
  if (filters.status && ["open", "closed"].includes(filters.status)) {
    clauses.push(eq(supportTickets.status, filters.status));
  }
  const where =
    clauses.length > 0 ? and(...clauses.filter(Boolean)) : undefined;

  // Open tickets are work; closed ones are history. The queue shows the work
  // first, newest at the top within each.
  const openFirst = sql`case when ${supportTickets.status} = 'open' then 0 else 1 end`;

  const result = await paginate(
    filters.page ?? 1,
    (offset) =>
      db
        .select({
          ticket: supportTickets,
          shopName: shops.name,
          shopHandle: shops.handle,
          ownerId: shops.userId,
        })
        .from(supportTickets)
        .innerJoin(shops, eq(shops.id, supportTickets.shopId))
        .where(where)
        .orderBy(openFirst, desc(supportTickets.createdAt))
        .limit(HQ_PAGE_SIZE)
        .offset(offset),
    async () => {
      const [totals] = await db
        .select({ n: sql<string>`count(*)` })
        .from(supportTickets)
        .innerJoin(shops, eq(shops.id, supportTickets.shopId))
        .where(where);
      return num(totals?.n);
    },
  );

  return result;
}
